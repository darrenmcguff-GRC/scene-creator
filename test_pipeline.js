// Scene Creator — Full Pipeline Test (corrected tokens)
const SUPABASE_BASE = 'https://xdvmmjzmxhydachhxmri.supabase.co/functions/v1/data-api';
const SUPABASE_TOKEN = 'e7ff494f3ec9f4478b702fa021e6997f32022cbd8328c3ce66ab41d4923e7eb1';
const HERMES_BRIDGE = 'https://hermes-bridge.luxtenebris.online';

async function test() {
  console.log('=== SCENE CREATOR FULL PIPELINE TEST ===\n');

  // --- Step 1: Generate detailed image prompt via Hermes Bridge ---
  console.log('Step 1: Generate image prompt via Hermes Bridge...');
  
  const description = 'A goblin den deep underground';
  const environment = 'cave';
  const theme = 'dark-gloom';

  const systemPrompt = `You are a battle map prompt generator for Foundry VTT. Generate a detailed image prompt for a top-down 2D battle map. Return ONLY the prompt text, no explanations, no markdown.`;

  const userPrompt = `Description: ${description}
Environment: ${environment} (cave, underground)
Theme: ${theme} (dark, foreboding, minimal light sources)
Dimensions: 1408x768 pixels (widescreen battle map)

Generate a detailed image prompt. Include: environment layout/terrain, lighting/colors based on theme, key features and obstacles, texture details.`;

  let imagePrompt;
  try {
    const resp = await fetch(HERMES_BRIDGE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma4:31b-cloud',
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        options: { temperature: 0.8 }
      })
    });
    const text = await resp.text();
    const data = JSON.parse(text);
    imagePrompt = data.message?.content || data.response;
    console.log('  ✅ Image prompt generated');
    console.log(`  Prompt (first 200 chars): "${imagePrompt.substring(0, 200)}..."`);
  } catch (e) {
    console.error('  ❌ Hermes Bridge failed:', e.message);
    imagePrompt = `Top-down 2D battle map of ${description}. ${environment} environment, ${theme} lighting. Dark cavern with stalactites, uneven stone floor, narrow passages, scattered rubble. Widescreen 1408x768.`;
    console.log('  ⚠️ Using fallback prompt');
  }

  console.log('');

  // --- Step 2: Generate image via Supabase ---
  console.log('Step 2: Generate image via Supabase (nano-banana-2)...');
  
  try {
    const resp = await fetch(SUPABASE_BASE + '/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_TOKEN}`
      },
      body: JSON.stringify({
        prompt: imagePrompt,
        model: 'nano-banana-2',
        width: 1408,
        height: 768
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText.substring(0, 300)}`);
    }

    const data = await resp.json();
    
    if (data.image) {
      const prefix = data.image.substring(0, 50);
      const isDataUri = data.image.startsWith('data:');
      console.log('  ✅ Image generated successfully!');
      console.log(`  Format: ${isDataUri ? 'Base64 data URI' : 'URL'}`);
      console.log(`  Length: ${data.image.length} chars`);
      console.log(`  Prefix: ${prefix}...`);
      
      // Save the image to a file for verification
      if (isDataUri) {
        const fs = require('fs');
        const base64Data = data.image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync('/tmp/scene_test_output.png', buffer);
        console.log(`  💾 Saved to /tmp/scene_test_output.png (${buffer.length} bytes)`);
      }
    } else {
      console.log('  Response keys:', Object.keys(data).join(', '));
      console.log('  Response:', JSON.stringify(data).substring(0, 500));
    }
  } catch (e) {
    console.error('  ❌ Supabase image generation failed:', e.message);
  }

  console.log('\n=== TEST COMPLETE ===');
}

test().catch(console.error);
