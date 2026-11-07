import Anthropic from "@anthropic-ai/sdk";
import { PLATFORM_LABEL, type Finding, type Platform } from "@/lib/platforms/types";

// Findings are computed deterministically (cheap, auditable). Claude only
// writes the plain-English summary, so a run costs a fraction of a cent to a
// few cents and the numbers can never be hallucinated.
export async function summarise(
  findings: Finding[],
  platform: Platform,
): Promise<string> {
  const total = findings.reduce((s, f) => s + f.estimatedSaving, 0);
  const fallback = `${findings.length} findings, about ${total.toFixed(0)} of projected monthly waste.`;
  if (!process.env.ANTHROPIC_API_KEY || findings.length === 0) return fallback;

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content:
            `You are a paid-media analyst. Summarise this ${PLATFORM_LABEL[platform]} audit for a busy marketer in 3-4 sentences. ` +
            "Lead with the biggest saving. Use only numbers present in the data. No preamble.\n\n" +
            JSON.stringify(
              findings.slice(0, 25).map((f) => ({
                kind: f.kind,
                title: f.title,
                rationale: f.rationale,
                projectedMonthlySaving: Math.round(f.estimatedSaving),
              })),
            ),
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text.trim() : fallback;
  } catch {
    return fallback;
  }
}
