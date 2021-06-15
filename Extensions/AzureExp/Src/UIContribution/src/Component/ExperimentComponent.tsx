import * as React from 'react';
import { Card, ICardTitleProps } from 'azure-devops-ui/Card';
import { Status, StatusSize, Statuses, IStatusProps } from "azure-devops-ui/Status";
import {
    ColumnFill,
    ISimpleTableCell,
    renderSimpleCell,
    Table,
    ITableColumn,
    SimpleTableCell
} from "azure-devops-ui/Table";
import { ObservableValue } from 'azure-devops-ui/Core/Observable';
import { ArrayItemProvider, IItemProvider } from 'azure-devops-ui/Utilities/Provider';
import { TitleSize } from 'azure-devops-ui/Header';

export interface ITableItem extends ISimpleTableCell {
    treatment: string;
    control: string;
    starttime: string;
    status: string;
    scorecard: string;
}

export interface IExperimentComponentProps {
    experiment: any;
    scorecards: any;
}

const ExperimentState = {
    'running': 'Running',
    'startrequested': 'Starting',
    'stoprequested': 'Stopping',
    'completed': 'Completed'
};

export class ExperimentComponent extends React.Component<IExperimentComponentProps> {
    constructor(props: IExperimentComponentProps) {
        super(props);
    }

    public render(): JSX.Element {
        return (
            <div className='experiment-card'>
                <Card
                    contentProps={{ contentPadding: false }}
                    titleProps={{text: this.props.experiment.Name, size: TitleSize.Small} as ICardTitleProps} 
                >
                    <Table 
                        columns={this._getFixedColumns()}
                        itemProvider={this._getTableItemProvider(this.props.experiment)}
                        role='table'
                        showLines={true}
                    />
                </Card>
            </div>
        );
    }

    private _getFixedColumns(): ITableColumn<any>[] {
        return [
            {
                id: 'treatment',
                name: 'Treatment %',
                readonly: true,
                renderCell: renderSimpleCell,
                width: new ObservableValue(100)
            },
            {
                id: 'control',
                name: 'Control %',
                readonly: false,
                renderCell: renderSimpleCell,
                width: new ObservableValue(100)
            },
            {
                id: 'starttime',
                name: 'Start Time',
                readonly: true,
                renderCell: renderSimpleCell,
                width: new ObservableValue(200)
            },
            {
                id: 'status',
                name: 'Status',
                readonly: true,
                renderCell: this._renderStatusCell,
                width: new ObservableValue(200)
            },
            {
                id: 'scorecard',
                name: 'Scorecard',
                readonly: true,
                renderCell: renderSimpleCell,
                width: new ObservableValue(500)
            },
            ColumnFill 
        ] as Array<ITableColumn<ITableItem>>;
    }

    private _getTableItemProvider(experiment): IItemProvider<ITableItem> {
        return new ArrayItemProvider<ITableItem>(this.props.experiment['Stages'].map((stage) => {
            let tableItem = {} as any as ITableItem;
            stage['ParallelSteps'].forEach((step) => {
                tableItem.treatment = step['FlightTrafficMap'][Object.keys(step['FlightTrafficMap'])[0]] || '--';
                tableItem.control = step['FlightTrafficMap'][Object.keys(step['FlightTrafficMap'])[1]] || '--';
                tableItem.scorecard = !!this.props.scorecards[step.Id] ? this.props.scorecards[step.Id].ScorecardLink || '--' : '--';
            });

            tableItem.status = stage.State;
            tableItem.starttime = !!stage.StartTime ? new Date(stage.StartTime).toDateString() : '--';

            return tableItem;
        }));
    }

    private _getStatusProps(status: string): IStatusProps {
        switch (status.toLowerCase()) {
            case 'running':
                return { ...Statuses.Running, ariaLabel: "Running" };
            case 'completed':
                return { ...Statuses.Success, ariaLabel: "Completed" };
            case 'stopped':
                return { ...Statuses.Failed, ariaLabel: "Stopped" };
            case 'startrequested': 
                return { ...Statuses.Waiting, ariaLabel: "StartRequested" };
            case 'stoprequested':
                return { ...Statuses.Waiting, ariaLabel: "StopRequested" };
        }
    }

    private _renderStatusCell = (rowIndex: number, columnIndex: number, tableColumn: ITableColumn<any>, tableItem: ITableItem) => {
        return (
            <SimpleTableCell
                columnIndex={columnIndex}
                tableColumn={tableColumn}
                key={`col-${columnIndex}`}
            >
                {
                    tableItem.status.toLowerCase() !== 'new' && 
                        <Status
                            {...this._getStatusProps(tableItem.status)}
                            className="icon-large-margin"
                            size={StatusSize.l}
                        />
                }
                <div className="flex-row scroll-hidden">
                    <span className="text-ellipsis">{tableItem.status.toLowerCase() !== 'new' ? ExperimentState[tableItem.status.toLowerCase()] || tableItem.status : '--'}</span>
                </div>
            </SimpleTableCell>
        );
    }
}