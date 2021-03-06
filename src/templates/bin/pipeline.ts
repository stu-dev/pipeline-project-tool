#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {PipelineStack} from '../lib/pipeline-stack';

const app = new cdk.App();
new PipelineStack(app, 'PipelineStack', {
  env: {account: '{{account_id}}', region: '{{project_region}}'},
  stackName: '{{project_name}}-pipeline',
});
