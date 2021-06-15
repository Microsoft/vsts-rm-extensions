import * as tl from 'azure-pipelines-task-lib';
import { RestClient, IRequestOptions } from 'typed-rest-client/RestClient';
import { ExpAuthorizer } from './expauthorizer';

export enum ExperimentAction {
    Start = "Start",
    Advance = "Advance",
    Stop = "Stop",
    StopAllExperiments = "StopAllExperiments"
}

export default class ExperimentManager {
    constructor(featureId: string, progressionId: string, serviceConnectionId: string, userAgent: string) {
        this._featureId = featureId;
        this._progressionId = progressionId;
        this._restClient = new RestClient(userAgent);
        this._expAuthorizer = new ExpAuthorizer(serviceConnectionId, userAgent);
    }

    public async executeAction(action: ExperimentAction, experiment: any): Promise<void> {
        let experimentId = experiment.Id;
        let experimentName = experiment.Name;
        let requestUrl = `https://exp.microsoft.com/api/experiments/${experimentId}`;
        let accessToken = await this._expAuthorizer.getAccessToken();
        let options: IRequestOptions = {
            additionalHeaders: {
                'authorization': `Bearer ${accessToken}`
            }
        };

        switch(action) {
            case ExperimentAction.Start: { 
                if (ExperimentManager.IsExperimentStopped(experiment, false)) {
                    tl.debug(`Experiment '${experimentName}' is stopped. Restarting the experiment.`);
                    experimentId = await this._cloneExperiment(this._featureId, this._progressionId, experimentId);
                    requestUrl = `https://exp.microsoft.com/api/experiments/${experimentId}/start`;
                }
                else {
                    requestUrl = `${requestUrl}/start`; 
                }
                
                break; 
            }
            case ExperimentAction.Advance: { 
                requestUrl = `${requestUrl}/advance`; 
                break; 
            }
            case ExperimentAction.Stop: { 
                requestUrl = `${requestUrl}/stop`; 
                break; 
            }
            default: {
                throw new Error(tl.loc('InvalidAction', action));
            }
        }

        console.log(tl.loc('InitiateAction', ExperimentAction[action], experimentName, experimentId));
        tl.debug(`[POST] ${requestUrl}`);
        let response = await this._restClient.create(requestUrl, null, options);
        console.log(tl.loc('InitiatedAction', ExperimentAction[action], experimentName, experimentId));
        tl.debug(JSON.stringify(response));
    }

    /**
     * @param experimentName filter by experiment name
    */
    public async getExperiments(experimentName?: string): Promise<any[]> {
        let requestUrl = `https://exp.microsoft.com/api/2.0/features/${this._featureId}/progressions/${this._progressionId}`;
        let accessToken = await this._expAuthorizer.getAccessToken();
        let options: IRequestOptions = {
            additionalHeaders: {
                'authorization': `Bearer ${accessToken}`
            }
        };

        tl.debug(`[GET] ${requestUrl}`);
        let response = await this._restClient.get(requestUrl, options);
        tl.debug(JSON.stringify(response));

        let progression = response.result as any;

        if (!!progression.Studies && progression.Studies.length > 0) {
            let experiments = progression.Studies as any[];
            if (!!experimentName) {
                experiments = experiments.filter(e => e.Name == experimentName);
                if (experiments.length === 0) {
                    throw new Error(tl.loc('NoExperimentWithNameFound', experimentName, this._progressionId, this._featureId));
                }
            }
    
            tl.debug(`Experiment: ${JSON.stringify(experiments)}`);
            let uniqueExperiments = this._removeDuplicateExperiments(experiments);
            return uniqueExperiments;
        }

        throw new Error(tl.loc('NoExperimentsFound', this._progressionId, this._featureId));
    }

    public static IsExperimentStopped(experiment: any, treatNotStartedAsStopped?: boolean): boolean {
        // an experiment is considered stopped if it has started and any of its stages is stopped (StopTime has been set)
        let experimentStages = experiment['Stages'];
        if (!!experimentStages && experimentStages.length > 0) {
            // experiment has not started
            if (experimentStages[0]['StartTime'] === null) {
                if (treatNotStartedAsStopped) {
                    return true;
                }

                return false;
            }

            for (let stage of experimentStages) {
                let stopTime = stage['StopTime'];
                let startTime = stage['StartTime'];
                if (startTime != null && stopTime === null) {
                    // stage has started but not ended
                    return false;
                }
            }
        }
        else {
            // this should not be hit, since the experiment will always have stage
            // return false since we are unable to detect experiment stages
            return false;
        }

        return true;
    }

    private async _cloneExperiment(featureId: string, progressionId: string, experimentId: string): Promise<string> {
        let requestUrl = `https://exp.microsoft.com/api/1.0/features/${featureId}/progressions/${progressionId}/stages/${experimentId}/clone`;
        let accessToken = await this._expAuthorizer.getAccessToken();
        let options: IRequestOptions = {
            additionalHeaders: {
                'authorization': `Bearer ${accessToken}`
            }
        };

        tl.debug(`Cloning experiment '${experimentId}'`);
        tl.debug(`[POST] ${requestUrl}`);
        let response = await this._restClient.create(requestUrl, null, options);
        let clonedExperimentId = response.result as string;
        tl.debug(`Cloned experiment id: ${clonedExperimentId}`);
        return clonedExperimentId;
    }

    private _removeDuplicateExperiments(experiments: any[]) {
        // group by experiment name
        let experimentsByNameMap: {[key: string]: any} = {};
        experiments.forEach((experiment: any) => {
            if (!experimentsByNameMap[experiment.Name]) {
                experimentsByNameMap[experiment.Name] = [];
            }

            experimentsByNameMap[experiment.Name].push(experiment);
        });

        // return a list of non-duplicate experiments
        let uniqueExperiments = [];
        for (let experimentName in experimentsByNameMap) {
            uniqueExperiments.push(this._getActiveExperiment(experimentsByNameMap[experimentName]));
        }

        return uniqueExperiments;
    }

    private _getActiveExperiment(experiments: any[]) {
        // if there are multiple experiments due to multiple restarts, return the current active experiment  (last cloned)
        let activeExperiment = experiments.find((experiment: any) => experiment.RestartedFromId === null);
        let activeExperimentFound = false;
        while (!activeExperimentFound) {
            activeExperimentFound = true;
            for (let experiment of experiments) {
                if (experiment.RestartedFromId === activeExperiment.Id) {
                    activeExperiment = experiment;
                    activeExperimentFound = false;
                    break;
                }
            }
            
        }

        return activeExperiment;
    }

    private _restClient: RestClient;
    private _expAuthorizer: ExpAuthorizer;
    private _featureId: string;
    private _progressionId: string;
}