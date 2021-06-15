import * as React from 'react';
import Spinner from 'react-spinner-material';

export class LoadingSpinner extends React.Component {
    public render() {
		return (
			<div style={{
				position: 'absolute',
				left: '50%',
				top: '50%',
				transform: 'translate(-50%, -50%)',
			}}>
				<Spinner size={60} spinnerColor={'#2b88d8'} spinnerWidth={3} visible={true} />
			</div>
		);
    }
}