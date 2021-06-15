import * as SDK from 'azure-devops-extension-sdk';
import * as Release from 'azure-devops-extension-api/Release';
import { 
    ServiceEndpointRestClient, 
    DataSourceDetails,  
    ServiceEndpointRequest, 
    ServiceEndpointRequestResult } from 'azure-devops-extension-api/ServiceEndpoint';
import { CommonServiceIds, getClient, IProjectPageService } from 'azure-devops-extension-api';
import { ReleaseRestClient } from 'azure-devops-extension-api/Release';

export default class ExpRestClient {
    public async getRelease(releaseId) {
        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const project = await projectService.getProject();
        
        let releaseClient = getClient(ReleaseRestClient);
        let release: Release.Release = await releaseClient.getRelease(project.id, releaseId);
        return release;
    }

    public async getProgression(serviceConnectionId: string, featureId: string, progressionId: string) {
        try {
            let progression = await this._executeDataSource(serviceConnectionId, 'GetExpProgression', {
                FeatureId: featureId,
                ProgressionId: progressionId
            });

            return progression;
        }
        catch (error) {
            throw new Error(`Unable to find progression with id ${progressionId} in feature ${featureId}. ${error.message}`);
        }
    }

    public async getFeature(serviceConnectionId: string, featureId: string): Promise<any> {
        try {
            let feature = await this._executeDataSource(serviceConnectionId, 'GetExpFeature', { 
                FeatureId: featureId 
            });

            return feature;
        }
        catch (error) {
            throw new Error(`Unable to find feature with id '${featureId}'. ${error.message}`);
        }
    }

    public async getScorecards(serviceConnectionId: string, featureId: string): Promise<any> {    
        try {
            let scorecards = await this._executeDataSource(serviceConnectionId, 'GetExpScoreCards', { 
                FeatureId: featureId 
            });

            return scorecards;
        }
        catch (error) {
            throw new Error(`Unable to fetch scorecards in feature with id '${featureId}'. ${error.message}`);
        }         
    }

    private async _executeDataSource(serviceConnectionId: string, dataSourceName: string, dataSourceParameters: {[key: string]: string}): Promise<any> {
        const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService);
        const project = await projectService.getProject();

        let dataSourceDetails: DataSourceDetails = {
            dataSourceName: dataSourceName,
            dataSourceUrl: null, 
            headers: null,
            requestContent: null,
            requestVerb: null,
            resourceUrl: null,
            parameters: dataSourceParameters,
            resultSelector: '',
            initialContextTemplate: ''
        };

        let serviceEndpointRequest: ServiceEndpointRequest = {
            dataSourceDetails: dataSourceDetails,
            resultTransformationDetails: null,
            serviceEndpointDetails: null
        };

        let serviceEndpointRestClient = getClient(ServiceEndpointRestClient);
        let result: ServiceEndpointRequestResult = await serviceEndpointRestClient.executeServiceEndpointRequest(serviceEndpointRequest, project.id, serviceConnectionId);

        if (parseInt(result.statusCode) == 200) {
            return JSON.parse(result.result);
        }
        else {
            throw new Error(result.errorMessage);
        }
    }
}