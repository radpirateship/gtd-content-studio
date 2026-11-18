/**
 * Image Studio API
 *
 * POST /api/image-studio
 *
 * action = 'prompts'  → Claude reads natural-language request, returns array of image prompts
 *   Body: { action: 'prompts', message: string }
 *   Returns: { prompts: { id, label, prompt }[] }
 *
 * action = 'generate' → Gemini generates a single image from a prompt
 *   Body: { action: 'generate', prompt: string, useBrandStyle?: boolean }
 *   Returns: { image: dataUri }
 */

import { NextRequest, NextResponse } from 'next/server';
import { callAI } from '@/lib/ai';
import { GTD_GLOBAL_STYLE } from '@/lib/gtd-image-style';
import { generateImageWithModel } from '@/lib/imageGeneration';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // ── Generate image from a single prompt ───────────────────────────────────
    if (action === 'generate') {
      const { prompt, useBrandStyle = false } = body as {
        prompt: string;
        useBrandStyle?: boolean;
      };

      if (!prompt?.trim()) {
        return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
      }

      const fullPrompt = useBrandStyle
        ? `${prompt}\n${GTD_GLOBAL_STYLE}`
        : prompt;

      const result = await generateImageWithModel(
        fullPrompt,
        'gemini-3.1-flash-image-preview',
        { aspectRatio: '16:9' }
      );

      if (!result) {
        return NextResponse.json({ error: 'Image generation failed — check GEMINI_API_KEY' }, { status: 500 });
      }

      return NextResponse.json({ image: result.url });
    }

    // ── Generate prompts from natural language ────────────────────────────────
    if (action === 'prompts') {
      const { message } = body as { message: string };

      if (!message?.trim()) {
        return NextResponse.json({ error: 'message is required' }, { status: 400 });
      }

      const systemPrompt = `You are an expert AI image prompt writer for Green Thumb Depot, a premium wellness equipment brand (greenthumbdepot.com).

Your job: read the user's natural-language request and return an array of detailed, ready-to-use image generation prompts for Gemini Imagen.

Rules for each prompt:
- 60-130 words, highly descriptive and specific
- Always include: subject, environment/setting, lighting quality, mood/atmosphere, and composition or camera angle
- Make every image in the set visually distinct — vary angle, time of day, weather, background, or styling
- Professional commercial photography or high-end editorial quality by default
- No text, logos, watermarks, or branding unless explicitly requested
- No people unless the user asks for them
- Do NOT add style guide or brand palette instructions — those get appended separately

Output: ONLY a valid JSON array, no markdown fences, no explanation text.

Each object:
{
  "id": "prompt-1",
  "label": "Short 3-5 word title",
  "prompt": "Full prompt text here..."
}`;

      const userPrompt = `User request: "${message}"

Return a JSON array. Match the number requested exactly (default to 5 if not specified).`;

      let raw = await callAI(systemPrompt, userPrompt, { maxTokens: 2500 });
      raw = raw.trim().replace(/^```json\s*/i, '').replace(/\n?```$/i, '').trim();

      let parsed: { id?: string; label?: string; prompt?: string }[];
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error('[image-studio] AI returned invalid JSON:', raw.slice(0, 300));
        return NextResponse.json({ error: 'AI returned invalid response — try again' }, { status: 500 });
      }

      const prompts = parsed
        .map((p, i) => ({
          id: p.id || `prompt-${i + 1}`,
          label: p.label || `Image ${i + 1}`,
          prompt: p.prompt || '',
        }))
        .filter(p => p.prompt.length > 0);

      return NextResponse.json({ prompts });
    }

    return NextResponse.json({ error: 'Invalid action. Use "prompts" or "generate"' }, { status: 400 });
  } catch (err) {
    console.error('[image-studio] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
