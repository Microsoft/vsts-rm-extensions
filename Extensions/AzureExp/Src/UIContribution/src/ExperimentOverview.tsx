import './ExperimentOverview.scss';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as Release from 'azure-devops-extension-api/Release';
import * as SDK from 'azure-devops-extension-sdk';
import ProgressionComponent from './Component/ProgressionComponent';
import ExpRestClient from './ExpRestClient';
import ExpUtility from './ExpUtility';
import { LoadingSpinner } from './Component/LoadingSpinner';
import { MessageCard, MessageCardSeverity } from 'azure-devops-ui/MessageCard';
import { Card, ICardTitleProps } from 'azure-devops-ui/Card';
import { TitleSize } from 'azure-devops-ui/Header';
import { Link } from 'azure-devops-ui/Link';
import { Icon } from 'azure-devops-ui/Icon';
import { Table, renderSimpleCell, ITableColumn, SimpleTableCell } from 'azure-devops-ui/Table';
import { ObservableValue } from 'azure-devops-ui/Core/Observable';
import { ArrayItemProvider } from 'azure-devops-ui/Utilities/Provider';

export interface IExperimentOverviewState {
    progression: any;
    feature: any;
    scorecards: any;
    loaded: boolean;
    error?: string;
}

export class ExperimentOverview extends React.Component<{}, IExperimentOverviewState> {
    constructor(props) {
        super(props);
        this.state = {
            loaded: false,
            progression: null,
            scorecards: null,
            feature: null
        };

        this._expClient = new ExpRestClient();
    }

    public componentDidMount() {
        SDK.register('registeredEnvironmentObject', {
            isInvisible: (context): boolean => {
                return !ExpUtility.isOverviewTabVisible(context);
            }
        });
        
        SDK.init();
        SDK.ready().then(() => {    
            let context = SDK.getConfiguration();
            console.log(`Extension context`, context);
            if (!!context.releaseEnvironment) {
                this._expClient.getRelease(context.releaseEnvironment.releaseId).then((release: Release.Release) => {
                    let [featureId, progressionId] = ExpUtility.getFeatureAndProgressionIdFromRelease(release);
                    if (!featureId) {
                        this.setState({
                            loaded: true,
                            error: "Failed to load UI contribution. FeatureId or ProgressionId variable has not been set in the pipeline."
                        });

                        return;
                    }

                    let serviceConnectionId = ExpUtility.getServiceConnectionId(context);
                    this._getUIObjects(serviceConnectionId, featureId, progressionId).then(([feature, progression, scorecards]) => {
                        this.setState({
                            progression: progression,
                            feature: feature,
                            scorecards: scorecards,
                            loaded: true,
                            error: ''
                        });
                    }, (error) => {
                        this.setState({
                            loaded: true,
                            error: !!error.message ? error.message : error
                        });
                    });
                });
            }
        });
    }

	public render(): JSX.Element {
		return (
			<div>
                {!this.state.loaded && <LoadingSpinner />}
                {!!this.state.error && this._getErrorComponent(this.state.error)}
                {!!this.state.feature && 
                    <Card
                        contentProps={{
                            className: 'feature-card-content'
                        }}
                        className='feature-card'
                        titleProps={{
                            text: this.state.feature.Name, 
                            size: TitleSize.Large
                        } as ICardTitleProps }
                        headerDescriptionProps={{
                            text: <div>
                                    {this.state.feature.Description + " "}
                                    <Link href={`https://exp.microsoft.com/a/feature/${this.state.feature.Id}`} target='_blank'>
                                        (Control tower <Icon iconName="NavigateExternalInline" />)
                                    </Link>
                                </div>
                        }}
                    >
                        {this._getFlightComponent(this.state.feature)}   
                        {!!this.state.progression && !!this.state.scorecards &&
                            <ProgressionComponent 
                                progression={this.state.progression}
                                scorecards={this.state.scorecards} />
                        }
                    </Card>
                }
			</div>
		);
    }

    private _getErrorComponent(error: string): JSX.Element {
        return (
            <MessageCard
                className='flex-self-stretch'
                severity={MessageCardSeverity.Error}
            >
                {error}
            </MessageCard>
        );
    }

    private _getFlightComponent(feature: any) {
        return (
            <Card
                titleProps={{
                    text: `Feature Gates`,
                    size: TitleSize.Medium
                }}
                className='flight-card'
            >
                <Table 
                    columns={this._getFixedColumns()}
                    itemProvider={this._getTableItemProvider(this.state.feature)}
                    role='table'
                    showLines={false}
                />
            </Card>
        );
    }

    private _getTableItemProvider(feature: any) {
        return new ArrayItemProvider(feature['Flights'].map((flight) => {
            let featuregates = flight.TreatmentVariables.map((treatmentVariable) => `${treatmentVariable.Namespace}.${treatmentVariable.Key}:${treatmentVariable.Value}`);
            return {
                flightname: `${flight.FlightType} flight : ${flight.Name}`,
                featuregatename: featuregates.join(',')
            };
        }))
    }

    private _getFixedColumns() {
        return [
            {
                id: 'flightname',
                name: 'Flight Name',
                readonly: true,
                renderCell: this._renderFlightNameCell,
                width: new ObservableValue(400)
            },
            {
                id: 'featuregatename',
                name: 'Feature gate name: Value',
                readonly: true,
                renderCell: renderSimpleCell,
                width: new ObservableValue(400)
            },
        ];
    }

    private _renderFlightNameCell = (rowIndex: number, columnIndex: number, tableColumn: ITableColumn<any>, tableItem: any) => {
        return (
            <SimpleTableCell
                columnIndex={columnIndex}
                tableColumn={tableColumn}
                key={`col-${columnIndex}`}
            >
                <Icon className='airplane-solid-icon' iconName="AirplaneSolid" />
                <div className="flex-row scroll-hidden">
                    <span className="text-ellipsis">{tableItem.flightname}</span>
                </div>
            </SimpleTableCell>
        );
    }

    private _getUIObjects(serviceConnectionId: string, featureId: string, progressionId: string): Promise<[any, any, any]> {
        let promises = [];

        let getFeaturePromise = this._expClient.getFeature(serviceConnectionId, featureId);

        promises.push(getFeaturePromise);

        if (!!progressionId) {
            let getProgressionPromise = this._expClient.getProgression(serviceConnectionId, featureId, progressionId);
            let getScorecardsPromise = this._expClient.getScorecards(serviceConnectionId, featureId);
            promises.push(getProgressionPromise, getScorecardsPromise);
        }
        
        return Promise.all(promises).then(([feature, progression, scorecards]) => {
            if (!!progression && !!progression['Studies']) {
                progression['Studies'] = ExpUtility.removeDuplicateExperiments(progression['Studies']);
            }

            return [feature, progression, scorecards];
        }, (error) => {
            return Promise.reject(error);
        });
    }
    
    private _expClient: ExpRestClient;
}

ReactDOM.render(<ExperimentOverview />, document.getElementById('experiment-overview'));