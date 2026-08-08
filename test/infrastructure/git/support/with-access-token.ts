import type { GitProviderContract } from '@brabo/shared';

// A suite de contrato compartilhada (test/contract/git-provider.contract.ts)
// nunca passa `accessToken` nos inputs — correto pro LocalGitProvider, que
// ignora, mas um problema real pro Github/Gitlab, cujos clients SDK são
// construídos por chamada a partir de `input.accessToken`. Em vez de mudar
// a suite compartilhada, este adapter injeta um token fixo antes de
// delegar — usado tanto pelos harnesses mockados (token fictício) quanto
// pelo smoke test opcional (token real).
export function withAccessToken(
  provider: GitProviderContract,
  token: string,
): GitProviderContract {
  return {
    name: provider.name,
    capabilities: provider.capabilities,
    createRepo: (input) =>
      provider.createRepo({ ...input, accessToken: token }),
    getRepo: (input) => provider.getRepo({ ...input, accessToken: token }),
    createBranch: (input) =>
      provider.createBranch({ ...input, accessToken: token }),
    protectBranch: (input) =>
      provider.protectBranch({ ...input, accessToken: token }),
    commitFiles: (input) =>
      provider.commitFiles({ ...input, accessToken: token }),
    listBranches: (input) =>
      provider.listBranches({ ...input, accessToken: token }),
    openPullRequest: (input) =>
      provider.openPullRequest({ ...input, accessToken: token }),
    mergePullRequest: (input) =>
      provider.mergePullRequest({ ...input, accessToken: token }),
    getFileContent: (input) =>
      provider.getFileContent({ ...input, accessToken: token }),
    commentOnPullRequest: (input) =>
      provider.commentOnPullRequest({ ...input, accessToken: token }),
    listTree: (input) => provider.listTree({ ...input, accessToken: token }),
    getPullRequestDiff: (input) =>
      provider.getPullRequestDiff({ ...input, accessToken: token }),
  };
}
