import { ChatInputCommandInteraction, PermissionsBitField } from "discord.js";
import { config } from "../config.js";

export function ensureAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  const member = interaction.member;
  if (!member || typeof member === "string") {
    return false;
  }

  const roles = member.roles;
  if (!roles || Array.isArray(roles)) {
    return false;
  }

  return roles.cache.has(config.DISCORD_ADMIN_ROLE_ID);
}