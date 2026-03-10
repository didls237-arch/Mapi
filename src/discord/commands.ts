import { SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("analyze")
    .setDescription("시장/티커 분석 15턴 자동 토론 실행")
    .addStringOption((opt) =>
      opt
        .setName("market")
        .setDescription("분석 시장")
        .setRequired(true)
        .addChoices(
          { name: "kor", value: "kor" },
          { name: "ex", value: "ex" },
          { name: "coin", value: "coin" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("ticker")
        .setDescription("티커 (예: AAPL, BTC)")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(20)
    ),
  new SlashCommandBuilder()
    .setName("summary")
    .setDescription("이전 summary 체크포인트 이후 로그 요약")
    .addStringOption((opt) =>
      opt
        .setName("scope")
        .setDescription("요약 범위")
        .setRequired(true)
        .addChoices(
          { name: "macro", value: "macro" },
          { name: "kor", value: "kor" },
          { name: "ex", value: "ex" },
          { name: "coin", value: "coin" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("thread_id")
        .setDescription("대상 thread ID (생략 시 현재 thread)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("rollover")
    .setDescription("스레드 컨텍스트를 압축해 새 스레드로 롤오버")
    .addStringOption((opt) =>
      opt.setName("thread_id").setDescription("롤오버할 thread ID").setRequired(true)
    ),
  new SlashCommandBuilder().setName("status").setDescription("봇 상태 확인")
];

export const commandsJson = commandBuilders.map((builder) => builder.toJSON());