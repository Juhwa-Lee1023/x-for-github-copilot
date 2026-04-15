# Porting Differences

Compared with upstream OMO:

- GitHub Copilot CLI packaging replaces OpenCode plugin packaging
- `.agent.md` files replace upstream TypeScript agent factories
- runtime-facing agent ids are renamed to GitHub-native names such as `repo-master` and `patch-master`
- `SKILL.md` directories replace OpenCode skill layout
- hooks are lighter and official Copilot CLI-only
- built-in MCPs are explicitly generated into [.github/mcp.json](../.github/mcp.json)
- the LSP subset is generated into [lsp.json](../lsp.json) during bootstrap
- runtime mirrors are generated from [source/](../source) to prevent drift across plugin and project-level surfaces
- an optional live runtime smoke exists, but stays conservative about what it proves
- no earlier intermediate dispatch or billing runtime is imported
