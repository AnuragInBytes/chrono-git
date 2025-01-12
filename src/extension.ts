import * as vscode from 'vscode';
import { authenticate, cleanup, refreshAccessToken } from './authenticate';
import { ensureMirrorRepo, mirrorRepos } from './sync';
import { selectReposForMirroring } from './repoSelection';
import { z } from 'zod';

const ConfigSchema = z.object({
	mirrorRepoOwner: z.string().optional(),
	syncInterval: z.number().min(60000).default(3 * 60 * 60 * 1000),
	mirrorRepo: z.string().optional(),
});

type ExtensionConfig = z.infer<typeof ConfigSchema>;

let syncIntervalHandle: NodeJS.Timeout | null = null;

async function validateAndConfig(): Promise<ExtensionConfig> {
	const config = vscode.workspace.getConfiguration('chronoGit');
	const rawConfig = {
		mirrorRepoOwner: config.get<string>('mirrorRepoOwner'),
		syncInterval: config.get<number>('syncInterval'),
		mirrorRepo: config.get<string>('mirrorRepo'),
	};

	const result = ConfigSchema.safeParse(rawConfig);
	if(!result.success) {
		throw new Error(`Invalid configuration: ${result.error.message}`);
	}
	return result.data;
}

async function ensureValidToken(context: vscode.ExtensionContext) {

	try {
		const { Octokit } = await import("octokit");
		const token = await context.secrets.get('githubAccessToken');

		if(!token) {
			vscode.window.showErrorMessage("No Github token found. Please authenticate again.");
			vscode.window.showInformationMessage("Authenticating...");
			await authenticate(context);
			return;
		}

		const refreshedToken = await refreshAccessToken(context);

		if(refreshedToken) {
			console.log("Access token refreshed.");
		}

		const config = await validateAndConfig();
		const octokit = new Octokit({ auth: token });

		if(!config.mirrorRepoOwner) {
			try {
				const { data: user } = await octokit.request("GET /user");
				await vscode.workspace.getConfiguration("chronoGit").update(
					'mirrorRepoOwner',
					user.login,
					vscode.ConfigurationTarget.Global
				);
				vscode.window.showInformationMessage(`Mirror Repository owner set to ${user.login}`);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to fetch user information. Please configure mirrorRepoOwner manually.`);
				console.error(error);
			}
		}
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to validate token: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

function scheduleBatchSync(context: vscode.ExtensionContext) {
	if(syncIntervalHandle) {
		clearInterval(syncIntervalHandle);
	}

	validateAndConfig().then(config => {
		syncIntervalHandle = setInterval(() => {
			mirrorRepos(context).catch(error => {
				vscode.window.showErrorMessage(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
			});
		}, config.syncInterval);
	}).catch(error => {
		vscode.window.showErrorMessage(`Failed to schedule sync: ${error instanceof Error ? error.message : 'Unknown error'}`);
	});
}

export async function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "chrono-git" is now active!');

	try {
		const token = await context.secrets.get("githubAccessToken");
		if(!token) {
			vscode.window.showErrorMessage("No access token found. Please authenticate.");
			vscode.window.showInformationMessage("Authenticating...");
			await authenticate(context);
		}
		await ensureValidToken(context);

		context.subscriptions.push(
			vscode.commands.registerCommand('chrono-git.authenticateGitHub', () => authenticate(context)),
			vscode.commands.registerCommand('chrono-git.syncChanges', async () => {
				try {
					await mirrorRepos(context);
				} catch (error) {
					vscode.window.showErrorMessage(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}),
			vscode.commands.registerCommand('chrono-git.selectRepos', async () => {
				try {
					const token = await context.secrets.get('githubAccessToken');
					if(!token) {
						vscode.window.showErrorMessage("No Access token found. Please Autheticate again.");
						vscode.window.showInformationMessage("Authenticating...");
						await authenticate(context);
						return;
					}
					await selectReposForMirroring(token, context);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to select repos: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			})
		);

		await ensureMirrorRepo(context);
		scheduleBatchSync(context);

	} catch (error) {
		vscode.window.showErrorMessage(`Extension activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

export function deactivate() {
	if(syncIntervalHandle) {
		clearInterval(syncIntervalHandle);
	}
	cleanup();
}
