-- A user may read their own assistant questions (ADR-0105 amendment, owner decision
-- 2026-10-15): the conversation history in the chat panel. The policy needs both the merchant
-- and the user of the session (DatabaseService.withContext with userId); plain merchant
-- transactions still read nothing. Token counts and cost stay with the platform: the API
-- never returns them to merchant users.
DROP POLICY IF EXISTS own_select ON assistant_requests;
--> statement-breakpoint
CREATE POLICY own_select ON assistant_requests FOR SELECT
  USING (merchant_id = app_current_merchant_id() AND user_id = app_current_user_id());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_requests_user_conversation_idx
  ON assistant_requests (merchant_id, user_id, surface, conversation_id, created_at);
