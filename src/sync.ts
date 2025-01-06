import * as vscode from 'vscode';

export async function ensureMirrorRepo(context: vscode.ExtensionContext) {

  const { Octokit } = await import("octokit");

  const token = await context.secrets.get("githubAccessToken");
  if(!token) {
    vscode.window.showErrorMessage("No tokens found. Please authenticate.");
    return;
  }

  const octokit = new Octokit({ auth: token });

  const mirrorRepoName = 'commit-mirror';
  const user = await octokit.request('GET /user');

  try {
    await octokit.request('GET /repos/{owner}/{repo}', {
      owner: user.data.login,
      repo: mirrorRepoName,
    });
    console.log("Mirror repo exists.");
  } catch (error) {
    await octokit.request('POST /user/repos', {
      name: mirrorRepoName,
      private: false,
      description: 'Mirror repo for tracking contribution',
    });
    vscode.window.showInformationMessage('Mirror repo created!');
  }

}

export async function mirrorRepos(context: vscode.ExtensionContext) {

  const { Octokit } = await import("octokit");

  const token = await context.secrets.get('githubAccessToken');
  if(!token) {
    vscode.window.showErrorMessage("No token found. Please authenticate.");
    return;
  }

  const octokit = new Octokit({ auth: token });

  const mirrorRepoName = 'commit-mirror';
  const user = await octokit.request('GET /user');

  const userRepos = await octokit.request('GET /user/repos', {
    visibility: 'all',
    per_page: 100,
  });

  for(const repo of userRepos.data) {
    if(repo.fork) {
      const commits = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: user.data.login,
        repo: repo.name,
        per_page: 5,
      });
      console.log("Debug 62: ", commits.data);
      const commitList = Array.isArray(commits.data) ? commits.data : [];
      for(const commit of commitList) {
        const message = `Mirror commit from ${repo.full_name}:\n\n${commit.commit.message}`;

        await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
          owner: user.data.login,
          repo: mirrorRepoName,
          message: message,
          tree: commit.commit.tree.sha,
          parent: [],
        });
      }
      console.log(`Commit mirrored from ${repo.name}`);
    }
  }

}
