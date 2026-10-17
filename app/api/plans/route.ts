import { NextResponse } from "next/server";
import { PlanBrief, bestOptions, briefProblem } from "@/lib/planner";
import { readNotes } from "@/lib/planNotes";
import { errorResponse } from "@/lib/server/errors";
import { planWithAi, understoodText, warmPlanModel } from "@/lib/server/planAi";

/**
 * POST /api/plans — body: a PlanBrief (rooms wanted, plot size, facing, setbacks, Vastu, and optionally the
 * visitor's own words). Returns the best 4–5 laid-out options, what their words were understood to mean, and
 * anything they asked for that can't be drawn. The local AI model's ideas are included when Ollama is running;
 * without it the rule-based options still come back, so this always answers. Needs no login.
 * `?debug=1` adds the model's reasoning steps and its rule breaks before and after review.
 */
export async function POST(request: Request) {
  try {
    const brief = PlanBrief.parse(await request.json().catch(() => null));
    // A brief that can't fit is answered straight away, with what to change, rather than with squeezed plans
    const problem = briefProblem(brief, readNotes(brief.notes).prefs);
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
    const ai = await planWithAi(brief);
    const options = bestOptions(brief, ai.concepts, 5, ai.prefs);
    const debug = new URL(request.url).searchParams.get("debug") === "1";
    return NextResponse.json({
      options,
      understood: understoodText(ai.prefs),
      unmet: ai.unmet,
      ai: { status: ai.status, note: ai.note, ...(debug ? { diag: ai.diag } : {}) },
    });
  } catch (err) {
    return errorResponse(err, "POST /api/plans");
  }
}

/** GET /api/plans — warms up the local AI model while the visitor is still answering. Always answers 200. */
export async function GET() {
  return NextResponse.json({ ai: (await warmPlanModel()) ? "ready" : "unavailable" });
}
