import vscode from 'vscode';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ path: __dirname + '/../.env' });

const clientId = process.env.GITHUB_CLIENT_ID as string;
const clientSecret = process.env.GITHUB_CLIENT_SECRET as string;

console.log('Client ID:', process.env.GITHUB_CLIENT_ID);
console.log('Client Secret:', process.env.GITHUB_CLIENT_SECRET);


if (!clientId || !clientSecret) {
    vscode.window.showErrorMessage('GitHub OAuth configuration error. Please check your .env file.');
    throw new Error('GitHub OAuth configuration error.');
}


export async function authenticate(context: vscode.ExtensionContext) {

    const { OAuthApp } = await import("@octokit/oauth-app");
    const open = (await import('open')).default;
    const app = new OAuthApp({
        clientId,
        clientSecret
    });

    const { url, state } = app.getWebFlowAuthorizationUrl({
        scopes: ['repo', 'read:user'],
    });

    // Open GitHub login page
    await open(url);

    const server = express();
    const port = 5000;
    let serverInstance: any;

    server.get('/callback', async (req, res) => {
        const { code, state: returnedState } = req.query;

        if (state !== returnedState) {
            res.send('State mismatch. Please try again.');
            return;
        }

        try {
            const { authentication } = await app.createToken({
                code: code as string,
            });

            await context.secrets.store("github_token", authentication.token);

            res.send("Authentication successful! You can close this window.");

        } catch (error) {
            res.send("Failed to authenticate.");
            console.error(error);
        } finally{
            serverInstance.close();
        }
    });

    serverInstance = server.listen(port, () => {
        console.log(`Listening on port ${port}`);
    });
}
