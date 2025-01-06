import * as vscode from 'vscode';
import { authenticate, refreshAccessToken } from './authenticate';
import { ensureMirrorRepo, mirrorRepos } from './sync';

async function ensureValidToken(context: vscode.ExtensionContext) {
	const token = await context.secrets.get('githubAccessToken');

	if(!token) {
		vscode.window.showErrorMessage("No Github token found. Please authenticate.");
		return;
	}
	const refreshedToken = await refreshAccessToken(context);

	if(refreshedToken) {
		console.log("Access token refreshed.");
	}
}

function scheduleBatchSync(context: vscode.ExtensionContext) {
	const syncInterval = 3 * 60 * 60 * 1000;
	setInterval(() => {
		mirrorRepos(context);
	}, syncInterval);
}

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "chrono-git" is now active!');
	
	ensureValidToken(context);
	context.subscriptions.push(
		vscode.commands.registerCommand('chrono-git.authenticate', () => {
			authenticate(context);
		})
	);

	ensureMirrorRepo(context);
	scheduleBatchSync(context);
	context.subscriptions.push(
		vscode.commands.registerCommand('chrono-git.syncChanges', () => {
			mirrorRepos(context);
		})
	);

	// const disposable = vscode.commands.registerCommand('chrono-git.authenticateGitHub', () => {
	// 	vscode.window.showInformationMessage('Hello World from Chrono Git!!');
	// 	authenticate(context);
	// });

	// context.subscriptions.push(disposable);
}

export function deactivate() {}
