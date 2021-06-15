import * as tl from 'azure-pipelines-task-lib';
import * as querystring from 'querystring';
import { HttpClient } from "typed-rest-client/HttpClient";
import { IHeaders } from 'typed-rest-client/Interfaces';

export class ExpAuthorizer {
    constructor(serviceConnectionId: string, userAgent: string) {
        this._serviceConnectionId = serviceConnectionId;
        this._httpClient = new HttpClient(userAgent);
    }

    public async getAccessToken(): Promise<string> {
        let servicePrincipalClientId = tl.getEndpointAuthorizationParameter(this._serviceConnectionId, 'serviceprincipalid', false);
        let servicePrincipalKey = tl.getEndpointAuthorizationParameter(this._serviceConnectionId, 'serviceprincipalkey', false);
        let tenantId = tl.getEndpointAuthorizationParameter(this._serviceConnectionId, 'tenantid', false);

        let url = `https://login.windows.net/${tenantId}/oauth2/token`;

        let data = querystring.stringify({
			resource: 'https://exp.microsoft.com',
			client_id: servicePrincipalClientId,
			grant_type: 'client_credentials',
			client_secret: servicePrincipalKey
		});

		let headers = {
			'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
		} as IHeaders;

        tl.debug('Fetching access token');
        tl.debug(`[POST] ${url}`);
        let response = await this._httpClient.post(url, data, headers);

        let responseBody = await response.readBody();
        if (response.message.statusCode === 200) {
            if (!!responseBody) {
                let accessToken = JSON.parse(responseBody)['access_token'];
                tl.setSecret(accessToken);
                return accessToken;
            }
            else {
                throw new Error(tl.loc('UnableToFetchAccessTokenNullResponse', response));
            }
        }
        else {
            throw new Error(tl.loc('UnableToFetchAccessToken', response.message.statusCode, responseBody));
        }
    }
    
    private _httpClient: HttpClient;
    private _serviceConnectionId: string;
}