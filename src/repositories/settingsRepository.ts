import { query } from "../db.js";
import { Persona } from "../types.js";

export async function upsertPersonaStyle(input: {
  guild_id: string;
  persona: Persona;
  style_text: string;
  actor_user_id: string;
}): Promise<void> {
  await query(
    `
    INSERT INTO persona_styles (guild_id, persona, style_text, updated_by_user_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, persona)
    DO UPDATE SET
      style_text = EXCLUDED.style_text,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = NOW()
    `,
    [input.guild_id, input.persona, input.style_text, input.actor_user_id]
  );
}

export async function deletePersonaStyle(input: { guild_id: string; persona: Persona }): Promise<boolean> {
  const rows = await query<{ deleted: boolean }>(
    `
    DELETE FROM persona_styles
    WHERE guild_id = $1 AND persona = $2
    RETURNING TRUE AS deleted
    `,
    [input.guild_id, input.persona]
  );
  return Boolean(rows[0]?.deleted);
}

export async function getPersonaStyles(guildId: string): Promise<
  Array<{
    persona: Persona;
    style_text: string;
    updated_by_user_id: string;
    updated_at: Date;
  }>
> {
  return query(
    `
    SELECT persona, style_text, updated_by_user_id, updated_at
    FROM persona_styles
    WHERE guild_id = $1
    ORDER BY persona ASC
    `,
    [guildId]
  );
}

export async function getPersonaStyleMap(guildId: string): Promise<Map<Persona, string>> {
  const rows = await getPersonaStyles(guildId);
  return new Map(rows.map((row) => [row.persona, row.style_text]));
}

export async function addSystemRule(input: {
  guild_id: string;
  rule_text: string;
  actor_user_id: string;
}): Promise<void> {
  await query(
    `
    INSERT INTO system_rules (guild_id, rule_text, created_by_user_id)
    VALUES ($1, $2, $3)
    `,
    [input.guild_id, input.rule_text, input.actor_user_id]
  );
}

export async function updateSystemRule(input: {
  guild_id: string;
  id: number;
  rule_text: string;
}): Promise<boolean> {
  const rows = await query<{ updated: boolean }>(
    `
    UPDATE system_rules
    SET rule_text = $3
    WHERE guild_id = $1 AND id = $2
    RETURNING TRUE AS updated
    `,
    [input.guild_id, input.id, input.rule_text]
  );
  return Boolean(rows[0]?.updated);
}

export async function deleteSystemRule(input: {
  guild_id: string;
  id: number;
}): Promise<boolean> {
  const rows = await query<{ deleted: boolean }>(
    `
    DELETE FROM system_rules
    WHERE guild_id = $1 AND id = $2
    RETURNING TRUE AS deleted
    `,
    [input.guild_id, input.id]
  );
  return Boolean(rows[0]?.deleted);
}

export async function listSystemRules(guildId: string): Promise<
  Array<{
    id: number;
    rule_text: string;
    created_by_user_id: string;
    created_at: Date;
  }>
> {
  return query(
    `
    SELECT id, rule_text, created_by_user_id, created_at
    FROM system_rules
    WHERE guild_id = $1
    ORDER BY created_at ASC
    `,
    [guildId]
  );
}
