/* SCENE CREATOR v1.3.0 — AI-powered scene background generation */
const SCENE_CREATOR_MODULE = 'scene-creator';

/* ── API Config (reuses the same Supabase config as NPC Creator) ── */
const API_TOKEN='e7ff494f3ec9f4478b702fa021e6997f32022cbd8328c3ce66ab41d4923e7eb1';
const API_BASE = 'https://xdvmmjzmxhydachhxmri.supabase.co/functions/v1/data-api';
const HERMES_URL = 'https://hermes-bridge.luxtenebris.online';
const DEFAULT_MODEL = 'gemma4:31b-cloud';

class SceneCreator {
  /* ── Generate a battle map image prompt via Ollama Bridge ── */
  static async _generateMapPrompt(name, description, environment, theme) {
    const ollamaModule = game.modules.get('ollama-bridge');
    let Ob;
    if (ollamaModule?.active) Ob = ollamaModule.api || globalThis.OllamaBridge;

    const systemPrompt = `You are a battle map prompt generator for Foundry VTT, trained on a specific visual style.

REFERENCE STYLE ANALYSIS (4 training images):
- Perspective: Top-down with subtle isometric depth — objects cast shadows and have visible height, but the camera is looking straight down. Balanced between pure top-down and isometric.
- Palette: Dark, warm, earthy tones. 80-90% neutral/warm, 10-20% warm accent. Deep browns, muted ochres, warm greys, dark earth tones. RGB values cluster in the 20-80 range per channel.
- Lighting: Dramatic, high-contrast. Deep shadows with warm highlights. Avg luminance 40-60/255 across the image with bright spots of 150+.
- Saturation: Rich and vibrant (0.48-0.65 avg). Colors are not desaturated or washed-out.
- Textures: Highly detailed with strong edge definition (edge intensity 38-46/255). Stone, wood, earth textures with visible grain and material variation.
- Format: Square tiles designed for grid-based map editors. Can tile seamlessly on edges.
- Key visual qualities: Rich material detail, dramatic shadow-to-light transitions, warm earthy color palette, visible surface texture on every tile type.

OUTPUT GUIDELINES:
- Generate prompts for a 1408×768 pixel widescreen battle map (NOT square tiles)
- Use the reference style: dark, warm, earthy palette with dramatic lighting
- Describe terrain features, walls, floors, obstacles visible from top-down
- Include color palette guidance: deep browns, warm neutrals, muted ochres, with subtle warm accent colors
- Include lighting guidance: high contrast, warm directional light, deep shadows
- Include texture detail: stone grain, wood grain, earth texture, material variation
- NO text, labels, numbers, grid lines, or UI elements
- 16:9 aspect ratio, high resolution, game-ready for virtual tabletop

Environment types: dungeon, forest, cave, city-street, castle-interior, temple, swamp, coastline, mountain-pass, desert, underwater, planar, tavern, library, laboratory
Theme types: day, night, dusk-dawn, dark-gloom, magical, fire-lit, underwater, celestial, hellish, fey-wild, ethereal, blood-soaked

Return ONLY the prompt text. 2-4 detailed sentences. No explanations, no markdown. No quotes. No labels. No grid. No text. No UI elements.`;

    const userPrompt = `Scene name: "${name}"
Description: ${description || 'A generic fantasy encounter area'}
Environment: ${environment || 'dungeon'}
Theme: ${theme || 'day'}

Generate a battle map image prompt using the reference style described above. Focus on: terrain layout visible from above, key features and obstacles, warm earthy color palette, dramatic lighting, rich surface textures.`;

    let rawText;
    if (Ob && typeof Ob.chat === 'function') {
      rawText = await Ob.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        model: game.settings.get('ollama-bridge', 'ollamaModel') || DEFAULT_MODEL,
        temperature: 0.6
      });
    } else {
      const resp = await fetch(`${HERMES_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: false,
          options: { temperature: 0.6 }
        })
      });
      if (!resp.ok) throw new Error(`AI HTTP ${resp.status}`);
      const data = await resp.json();
      rawText = data.message?.content || data.response || '';
    }

    // Clean up the response — ensure no markdown, quotes
    return rawText.replace(/^["']|["']$/g, '').trim();
  }

  /* ── Generate the image via Supabase ── */
  static async _generateSceneImage(prompt) {
    const model = 'nano-banana-2';
    const resp = await fetch(`${API_BASE}/images/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`
      },
      body: JSON.stringify({ prompt, model })
    });

    if (resp.status === 401) throw new Error('Invalid or disabled API token.');
    if (resp.status === 429) throw new Error('Rate limit exceeded. Please wait.');
    if (resp.status === 402) throw new Error('AI credits exhausted. Top up in workspace settings.');
    if (!resp.ok) throw new Error(`Image API HTTP ${resp.status}`);

    const result = await resp.json();
    if (!result?.imageUrl) throw new Error('Image API returned no image URL.');

    return result.imageUrl;
  }

  /* ── Fetch image and convert to data URI ── */
  static async _imageToDataUri(imageUrl) {
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      // Fallback to the URL
      return imageUrl;
    }
  }

  /* ── Create the Foundry Scene ── */
  static async createScene(name, imageUri, { environment, theme } = {}) {
    // Determine scene dimensions from the image or use defaults
    // 1408x768 is the standard Supabase output — scale to a 25x13 grid at 50px
    // That gives us a nice manageable battle map
    const gridSize = 50;
    const imgWidth = 1408;
    const imgHeight = 768;
    const gridW = Math.floor(imgWidth / gridSize);   // 28 columns
    const gridH = Math.floor(imgHeight / gridSize);  // 15 rows

    // Map environment to a hex color
    const envColors = {
      'dungeon': '#0a0a0a',
      'forest': '#1a2e1a',
      'cave': '#0d0d0d',
      'city-street': '#2a2a2a',
      'castle-interior': '#1a1a2a',
      'temple': '#1a1a2e',
      'swamp': '#1a2a1a',
      'coastline': '#1a2a3a',
      'mountain-pass': '#2a2a3a',
      'desert': '#2a2a1a',
      'underwater': '#0a1a3a',
      'planar': '#2a0a3a',
      'tavern': '#2a1a0a',
      'library': '#1a1a2a',
      'laboratory': '#1a2a2a'
    };
    const bgColor = envColors[environment] || '#1a1a2e';

    const sceneData = {
      name: name || 'Generated Scene',
      img: imageUri,
      width: imgWidth,
      height: imgHeight,
      padding: 0,
      backgroundColor: bgColor,
      grid: {
        type: 1,   // Square grid (0=gridless, 1=square, 2=hex-row, 3=hex-col)
        size: gridSize,
        distance: 5,
        units: 'ft.',
        alpha: 0.2,
        color: '#ffffff'
      },
      fogOverlay: '',
      fogExploration: true,
      globalLight: true,
      hasGlobalLight: true,
      darkness: (theme === 'night' || theme === 'dark-gloom' || theme === 'underwater') ? 0.75 : 0,
      tokenVision: true,
      initial: {
        x: 0,
        y: 0,
        scale: 1
      }
    };

    const scene = await Scene.create(sceneData);
    if (!scene) throw new Error('Failed to create scene.');

    return scene;
  }

  /* ── Full pipeline: describe → AI prompt → generate image → create scene ── */
  static async generateAndCreateScene(name, description, { environment, theme } = {}) {
    // Step 1: AI generates a detailed battle map prompt
    const mapPrompt = await SceneCreator._generateMapPrompt(name, description, environment, theme);
    console.log('Scene Creator: AI map prompt:', mapPrompt);

    // Step 2: Generate the image
    const imageUrl = await SceneCreator._generateSceneImage(mapPrompt);
    console.log('Scene Creator: Image URL:', imageUrl);

    // Step 3: Convert to data URI for Foundry compatibility
    const imageUri = await SceneCreator._imageToDataUri(imageUrl);

    // Step 4: Create the scene
    const scene = await SceneCreator.createScene(name, imageUri, { environment, theme });

    // Step 5: Activate and view the scene
    await scene.activate();
    await scene.view();

    return scene;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   APPLICATION
   ═══════════════════════════════════════════════════════════════════ */
class SceneCreatorApp extends FormApplication {
  constructor() {
    super({});
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'scene-creator-app',
      title: 'Scene Creator',
      template: 'modules/scene-creator/templates/scene-creator-app.html',
      width: 520,
      height: 500,
      resizable: true,
      classes: ['scene-creator']
    });
  }

  getData() {
    return {
      environments: [
        { value: 'dungeon', label: '🏚️ Dungeon' },
        { value: 'forest', label: '🌲 Forest' },
        { value: 'cave', label: '🕳️ Cave' },
        { value: 'city-street', label: '🏙️ City Street' },
        { value: 'castle-interior', label: '🏰 Castle Interior' },
        { value: 'temple', label: '⛪ Temple' },
        { value: 'swamp', label: '🌿 Swamp' },
        { value: 'coastline', label: '🌊 Coastline' },
        { value: 'mountain-pass', label: '⛰️ Mountain Pass' },
        { value: 'desert', label: '🏜️ Desert' },
        { value: 'underwater', label: '🌊 Underwater' },
        { value: 'planar', label: '🌀 Planar' },
        { value: 'tavern', label: '🍺 Tavern' },
        { value: 'library', label: '📚 Library' },
        { value: 'laboratory', label: '🧪 Laboratory' }
      ],
      themes: [
        { value: 'day', label: '☀️ Day' },
        { value: 'night', label: '🌙 Night' },
        { value: 'dusk-dawn', label: '🌅 Dusk/Dawn' },
        { value: 'dark-gloom', label: '🌑 Dark & Gloomy' },
        { value: 'magical', label: '✨ Magical' },
        { value: 'fire-lit', label: '🔥 Fire-lit' },
        { value: 'underwater', label: '🌊 Underwater' },
        { value: 'celestial', label: '⭐ Celestial' },
        { value: 'hellish', label: '🔥 Hellish' },
        { value: 'fey-wild', label: '🧚 Fey Wild' },
        { value: 'ethereal', label: '👻 Ethereal' },
        { value: 'blood-soaked', label: '🩸 Blood-soaked' }
      ]
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('#scene-btn-generate').click(async () => {
      await this._generateScene();
    });

    // Enter key on scene name triggers generate
    html.find('#scene-name').on('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this._generateScene();
      }
    });

    // Ctrl+Enter on description triggers generate
    html.find('#scene-description').on('keydown', async (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        await this._generateScene();
      }
    });
  }

  async _generateScene() {
    const name = this.element.find('#scene-name').val()?.trim();
    const description = this.element.find('#scene-description').val()?.trim();
    const environment = this.element.find('#scene-environment').val();
    const theme = this.element.find('#scene-theme').val();

    if (!name) {
      ui.notifications.warn('Enter a scene name.');
      return;
    }

    const generateBtn = this.element.find('#scene-btn-generate');
    const statusArea = this.element.find('#scene-status');

    generateBtn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Generating...');
    statusArea.show();
    statusArea.html('<div class="scene-status-step"><i class="fas fa-spinner fa-spin"></i> AI is designing your scene...</div>');

    try {
      // Step 1: AI prompt generation
      statusArea.html('<div class="scene-status-step"><i class="fas fa-spinner fa-spin"></i> AI crafting battle map description...</div>');
      const mapPrompt = await SceneCreator._generateMapPrompt(name, description, environment, theme);

      // Step 2: Image generation
      statusArea.html(`<div class="scene-status-step"><i class="fas fa-spinner fa-spin"></i> Generating image via Supabase...</div>`);
      const imageUrl = await SceneCreator._generateSceneImage(mapPrompt);

      // Step 3: Convert to data URI
      statusArea.html(`<div class="scene-status-step"><i class="fas fa-spinner fa-spin"></i> Processing image...</div>`);
      const imageUri = await SceneCreator._imageToDataUri(imageUrl);

      // Step 4: Create the scene
      statusArea.html(`<div class="scene-status-step"><i class="fas fa-spinner fa-spin"></i> Creating Foundry scene...</div>`);
      const scene = await SceneCreator.createScene(name, imageUri, { environment, theme });

      // Step 5: Activate
      statusArea.html(`<div class="scene-status-step"><i class="fas fa-spinner fa-spin"></i> Activating scene...</div>`);
      await scene.activate();
      await scene.view();

      statusArea.html(`<div class="scene-status-step scene-success">
        <i class="fas fa-check-circle"></i> Scene "${name}" created and activated!
      </div>`);

      ui.notifications.success(`Scene "${name}" created!`);

      // Reset button after a moment
      setTimeout(() => {
        generateBtn.prop('disabled', false).html('<i class="fas fa-wand-magic-sparkles"></i> ✨ Generate Scene');
      }, 2000);

    } catch (err) {
      console.error('Scene Creator error:', err);
      statusArea.html(`<div class="scene-status-step scene-error">
        <i class="fas fa-exclamation-triangle"></i> ${SceneCreatorApp.escapeHtml(err.message)}
      </div>`);
      ui.notifications.error(`Failed to create scene: ${err.message}`);
      generateBtn.prop('disabled', false).html('<i class="fas fa-wand-magic-sparkles"></i> ✨ Generate Scene');
    }
  }

  static escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════════════ */

Hooks.once('init', () => {
  console.log('Scene Creator v1.3.0 initialized');
});

// Add button to the Scenes section of the Scene toolbar
// V14 note: must use controls.set() to trigger reactivity — mutating .tools.push() is invisible
Hooks.on('getSceneControlButtons', (controls) => {
  const tool = {
    name: 'scene-creator-open',
    title: 'Generate AI Scene',
    icon: 'fas fa-wand-magic-sparkles',
    onClick: () => {
      const app = new SceneCreatorApp();
      app.render(true);
    },
    button: true
  };

  // V14: SceneControlCollection — must use .set() for reactivity
  if (controls?.constructor?.name === 'SceneControlCollection') {
    const scenesCtrl = controls.get('scenes');
    if (scenesCtrl) {
      controls.set('scenes', foundry.utils.mergeObject(scenesCtrl, {
        tools: [...(scenesCtrl.tools || []), tool]
      }, { inplace: false }));
    } else {
      controls.set('scenes', { name: 'scenes', title: 'Scenes', icon: 'fas fa-map', layer: 'scenes', tools: [tool] });
    }
    return;
  }

  // V10–V13: controls is an array of control groups
  if (Array.isArray(controls)) {
    const scenesCtrl = controls.find(c => c.name === 'scenes');
    if (scenesCtrl) {
      scenesCtrl.tools.push(tool);
    } else {
      controls.push({ name: 'scenes', title: 'Scenes', icon: 'fas fa-map', layer: 'scenes', tools: [tool] });
    }
    return;
  }

  // Fallback for other structures
  if (controls?.tools) {
    controls.tools.push(tool);
    return;
  }

  const arr = controls?._controls || controls?.controls;
  if (Array.isArray(arr)) {
    const scenesCtrl = arr.find(c => c.name === 'scenes');
    if (scenesCtrl) scenesCtrl.tools.push(tool);
    else arr.push({ name: 'scenes', title: 'Scenes', icon: 'fas fa-map', layer: 'scenes', tools: [tool] });
  }
});

// Also add button to Scene Directory header
Hooks.on('renderSceneDirectory', (app, html, data) => {
  const $html = html instanceof jQuery ? html : $(html);
  const header = $html.find('.directory-header');
  const btn = $(`
    <button class="scene-creator-directory-btn" title="Scene Creator">
      <i class="fas fa-wand-magic-sparkles"></i>
    </button>
  `);
  btn.on('click', () => {
    const app = new SceneCreatorApp();
    app.render(true);
  });
  header.find('.header-actions').append(btn);
});
