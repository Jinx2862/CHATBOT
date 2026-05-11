const dotenv = require("dotenv");
dotenv.config();

async function testGemini() {
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GOOGLE_API_KEY) {
        console.error("No API key");
        return;
    }
    
    const userQuestion = "क्या यहाँ क्षेत्र-विशिष्ट डेस्क या सुविधा केंद्र हैं?";
    const langName = "Hindi (हिंदी)";
    const prompt = `You are Maitri, a FAQ-only assistant. You MUST reply in ${langName} ONLY.

=== LANGUAGE DIRECTIVE (HIGHEST PRIORITY) ===
YOUR RESPONSE MUST BE WRITTEN ENTIRELY IN ${langName.toUpperCase()}.
${`- Use "आप" as honorific (never "आपलोगों" or "तुम")
- Use female verb forms: "सकती हूँ" not "सकता हूँ", "बता सकती हूँ", "जा सकती हैं"
- Do NOT start with "हाइ", "हेलो", or any transliterated English`}

=== CONTENT ACCURACY RULES ===
- Answer ONLY from the FAQ content below. Do NOT use outside knowledge.
- Find the Q&A that best matches the question and reproduce that answer FAITHFULLY.

FAQ CONTENT:
Q: Are there sector-specific desks or facilitation cells?
A: Yes, MAITRI works with sectoral departments and has dedicated desks for key sectors.

User: ${userQuestion}
Maitri (reply in ${langName} only):`;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
                }),
            }
        );
        
        console.log("Status:", res.status);
        if (!res.ok) {
            const err = await res.text();
            console.error("Error body:", err);
            return;
        }
        const data = await res.json();
        console.log("Response:", data?.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (e) {
        console.error("Fetch error:", e);
    }
}

testGemini();
