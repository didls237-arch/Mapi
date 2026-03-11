import { ChannelType, Message, TextChannel, ThreadChannel } from "discord.js";
import { config } from "../config.js";
import { getThreadState, insertAuditLog, upsertThreadState } from "../repositories/stateRepository.js";
import { discussionTurn, startDiscussion } from "./openclawClient.js";

function compactMessageContent(message: Message): string {
  const text = message.content.trim();
  const attachmentUrls = [...message.attachments.values()].map((a) => a.url);

  if (text.length === 0 && attachmentUrls.length > 0) {
    return `첨부 파일: ${attachmentUrls.join(" ")}`;
  }
  if (attachmentUrls.length === 0) {
    return text;
  }
  return `${text}\n첨부 파일: ${attachmentUrls.join(" ")}`;
}

function splitForDiscord(content: string, max = 1900): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= max) {
    return [normalized];
  }

  const parts: string[] = [];
  let rest = normalized;

  while (rest.length > max) {
    const hard = rest.slice(0, max);
    let cut = hard.lastIndexOf("\n");
    if (cut < max * 0.5) {
      cut = hard.lastIndexOf(" ");
    }
    if (cut < max * 0.5) {
      cut = max;
    }

    const chunk = rest.slice(0, cut).trim();
    if (chunk.length > 0) {
      parts.push(chunk);
    }

    rest = rest.slice(cut).trimStart();
  }

  if (rest.length > 0) {
    parts.push(rest);
  }

  return parts;
}

/**
 * 매크로 시나리오 채널에서 일반 메시지에 응답.
 * 스레드 안이면 기존 discussion 이어가고,
 * 일반 텍스트 채널이면 자동으로 스레드 생성 후 응답.
 */
export async function handleMacroScenarioMessage(input: {
  message: Message;
  actorUserId: string;
}): Promise<void> {
  const { message, actorUserId } = input;
  if (!message.guildId) return;

  const userPrompt = compactMessageContent(message);
  if (!userPrompt || userPrompt.trim().length === 0) return;

  // 스레드 안에서 메시지인 경우
  if (message.channel.isThread()) {
    const thread = message.channel as ThreadChannel;
    // macro 채널의 스레드인지 확인
    if (thread.parentId !== config.MACRO_FORUM_CHANNEL_ID) return;

    await handleInThread(thread, userPrompt, message, actorUserId);
    return;
  }

  // 일반 텍스트 채널에서 메시지인 경우
  if (message.channel.type === ChannelType.GuildText) {
    if (message.channel.id !== config.MACRO_FORUM_CHANNEL_ID) return;

    // 자동으로 스레드 생성
    const thread = await message.startThread({
      name: userPrompt.slice(0, 60) || "매크로 시나리오",
      autoArchiveDuration: 10080
    });

    await handleInThread(thread as ThreadChannel, userPrompt, message, actorUserId);
    return;
  }
}

async function handleInThread(
  thread: ThreadChannel,
  userPrompt: string,
  message: Message,
  actorUserId: string
): Promise<void> {
  await thread.sendTyping();

  let state = await getThreadState(thread.id);
  if (!state?.openclaw_discussion_id) {
    const start = await startDiscussion({
      market: "macro",
      ticker: "MACRO",
      thread_id: thread.id,
      mode: "macro",
      system_rules: [
        "관리자와의 대화를 참가자에게 공유 가능한 형태로 간결하게 답변하라.",
        "적어도 2개 이상의 출처 교차검증 원칙을 따르라.",
        "사용자 친화 칭찬 문구를 금지한다."
      ]
    });

    await upsertThreadState({
      scope: "macro",
      discord_thread_id: thread.id,
      discord_parent_channel_id: config.MACRO_FORUM_CHANNEL_ID,
      openclaw_discussion_id: start.discussion_id
    });

    state = {
      scope: "macro",
      discord_thread_id: thread.id,
      discord_parent_channel_id: config.MACRO_FORUM_CHANNEL_ID,
      linked_previous_thread_id: null,
      openclaw_discussion_id: start.discussion_id
    };
  }

  const discussionId = state.openclaw_discussion_id;
  if (!discussionId) {
    throw new Error("Macro discussion id를 초기화하지 못했습니다.");
  }

  const result = await discussionTurn(discussionId, {
    prompt: userPrompt,
    context: `thread_id=${thread.id}`
  });

  const chunks = splitForDiscord(result.content, 1900);
  for (const chunk of chunks) {
    await thread.send(chunk);
  }

  await insertAuditLog({
    event_type: "macro_chat_turn",
    guild_id: message.guildId!,
    actor_user_id: actorUserId,
    details: {
      thread_id: thread.id,
      message_id: message.id,
      response_chunks: chunks.length
    }
  });
}
