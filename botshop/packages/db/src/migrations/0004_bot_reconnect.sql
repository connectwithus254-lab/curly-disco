-- Bot reconnection.
--
-- Bug: `bots_telegram_bot_id_key` was unique across ALL rows, so once a bot had been connected
-- (telegram_bot_id set) and then disconnected (status = 'revoked'), reconnecting the same Telegram
-- bot — or rotating its token in @BotFather and pasting the new one — failed with a unique
-- violation surfacing as HTTP 500.
--
-- Two different live bots must still be unable to claim the same Telegram bot id, so the index
-- becomes partial: it applies only to rows that are not revoked. Revoked rows are kept as history.

drop index if exists bots_telegram_bot_id_key;

create unique index bots_telegram_bot_id_active_key
  on bots (telegram_bot_id)
  where telegram_bot_id is not null and status <> 'revoked';
