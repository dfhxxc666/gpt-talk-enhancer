# GPT TalkEnhancer project collaboration rules

- Target environment: Windows 11 with PowerShell 7.
- Use UTF-8 for source, test, and documentation files.
- Prefer PowerShell for project operations.
- Do not modify files outside this project directory.
- Ask before deleting files. New temporary files may only be removed when their safety is explicit.
- Explain the plan before a broad change.
- Run the necessary tests after changing code.
- Preserve the existing project structure and coding style.
- Do not add dependencies without a clear need.
- Do not overwrite existing configuration unless the task explicitly requires it.
- Keep the product scope limited to Conversation Timeline and Prompt Picker / Prompt Library.
- Do not use Pagebuster, internal RPC, thread/list, thread/read, React internals, database access, credential/token access, or automatic prompt sending. Network interception is prohibited except for the GPT TalkEnhancer 0.3 read-only MAIN-world capture of GET /backend-api/conversation/{conversationId}; that exception may only clone the successful response for mapping/current_node parsing and must never modify or block the original request/response.
