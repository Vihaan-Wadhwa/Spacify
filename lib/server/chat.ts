export function chatSystemPrompt(projectContext: string) {
  return `You are Spacify AI, an expert Indian interior design assistant. You help property designers and builders with wall colours, kitchen layouts, flooring (tiles, marble, vitrified), false ceiling designs, Vastu compliance, furniture arrangement, lighting, and general interior design advice. Keep responses concise, practical, and relevant to Indian homes. Current project context: ${projectContext}`;
}

/** Canned answers used when the chat workflow isn't configured or can't be reached. */
export function fallbackReply(text: string): string {
  const t = text.toLowerCase();
  if ((t.includes("wall") && t.includes("colour")) || t.includes("wall color")) {
    return "For living rooms, warm whites like Ivory or Cream work beautifully. Try Asian Paints OBL Antique White (N2) or Berger Silk Magnolia. For bedrooms, soft blues and sage greens promote calm — Asian Paints Aqua Splash or Jade Fantasy are popular. Master bedrooms look great in warm beiges like Cashmere or Sandstorm.";
  }
  if (t.includes("kitchen")) {
    return "For Indian kitchens, an L-shaped or parallel layout works best for functionality. Keep the cooking range away from windows to avoid wind affecting the flame. Use 2-3 feet of counter space on either side of the hob. Glazed tiles up to 2 feet above the counter are easiest to clean. Light colours like white or light grey make small kitchens feel larger.";
  }
  if (t.includes("vastu")) {
    return "Key Vastu tips: Main entrance should face North, East, or North-East. Kitchen in South-East corner (fire element). Master bedroom in South-West. Pooja room in North-East. Avoid beams directly above beds. Keep the centre of the house (Brahmasthan) open and clutter-free.";
  }
  if (t.includes("false ceiling")) {
    return "Popular false ceiling options: POP (Plaster of Paris) — most common, smooth finish, good for indirect lighting. Gypsum board — faster to install, lightweight. L-shaped coves with LED strips look great in living rooms. For bedrooms, a simple central medallion with a chandelier point works well. Recommended height: keep at least 9 feet after false ceiling.";
  }
  if (t.includes("marble") || t.includes("vitrified") || t.includes("tiles") || t.includes("flooring")) {
    return "Marble: Elegant, cool underfoot, great for living areas. Needs sealing and regular maintenance. Italian marble (Statuario, Carrara) is premium. Indian marble (Makrana white) is more affordable.\nVitrified tiles: Durable, low maintenance, scratch-resistant. Double-charged vitrified is most popular for Indian homes. 800x800mm or 600x1200mm sizes look modern.\nRecommendation: Marble for living/dining, vitrified for bedrooms, anti-skid ceramic for bathrooms.";
  }
  if (t.includes("colour") || t.includes("color")) {
    return "Current trending colours for Indian homes: Warm whites and off-whites (timeless), Sage green (calm, modern), Terracotta and earthy tones (warm, cultural), Navy blue accent walls (bold), Warm greige (grey+beige). Avoid very dark colours in small rooms. Use the 60-30-10 rule: 60% dominant colour, 30% secondary, 10% accent.";
  }
  return "I can help with wall colours, kitchen layouts, flooring options, false ceiling designs, Vastu tips, and furniture arrangement. What specific aspect of your home design would you like advice on? (Note: Connect the n8n chatbot workflow for full AI responses.)";
}

/** Pulls the reply text out of the various shapes an n8n workflow may return. */
export function extractReply(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.length ? extractReply(data[0]) : null;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["reply", "text", "response", "output", "message"]) {
      if (typeof obj[key] === "string" && obj[key]) return obj[key] as string;
    }
  }
  return null;
}
