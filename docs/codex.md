# Codex in Jarvis

The menu's Chat engine selector chooses Claude or Codex. Each engine keeps a
separate conversation ID; switching never sends one provider's ID to the other.
Claude stays the default. Codex is offered only when CODEX_ENABLED=true.

The image includes Codex CLI 0.163.0. It runs with read-only sandboxing,
approvals denied, user configuration ignored, and command tools, account-connected apps, computer use, browser use, and image viewing disabled. The image installs the system CA certificate bundle for authenticated HTTPS connections.
The app supplies bounded markdown excerpts from the shared vault, selecting
the vault index, priorities, and notes with names matching the question.
Retrieval excludes hidden paths, symlinks, and non-markdown files. This is
limited retrieval, not access to every note's full contents.

Sign-in is separate from choosing the engine. CODEX_HOME points to
/home/node/.codex in the existing persistent home volume. Sign in privately
with `docker exec -it jarvis-web codex login --device-auth`, or initialize the
server's auth cache from the owner's existing local sign-in over SSH, following
the official headless authentication instructions. Never put credentials in
source, browser responses, logs, notes, or image layers. Active sessions refresh
credentials on the server; a server logout requires another sign-in.

Local Codex chats use AGENTS.md to find the same vault and project. This shares
notes and project context; it does not synchronize chat transcripts or make the
web app able to message an open desktop chat.

References:
- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/non-interactive-mode
