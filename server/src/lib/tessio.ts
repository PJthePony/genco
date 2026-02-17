import { env } from "../config.js";

export interface CreateTaskResult {
  id: string;
  title: string;
  notes: string;
  location: string;
  created_at: number;
}

/**
 * Create a task in Tessio on behalf of a user.
 * Uses the service key so Genco can create tasks for P.J. directly.
 */
export async function createTessioTask(
  userId: string,
  title: string,
  notes?: string,
): Promise<CreateTaskResult> {
  const response = await fetch(env.TESSIO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TESSIO_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      title,
      notes: notes || "",
      location: "later",
      tags: ["genco"],
      target_user_id: userId,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      `Tessio API error (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return response.json();
}
