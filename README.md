pipeline-project-tool
=====================

Scaffold and deploy opinionated AWS CodeCommit repository + AWS CDK pipeline + AWS Lambda stack

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/pipeline-project-tool.svg)](https://npmjs.org/package/pipeline-project-tool)
[![Downloads/week](https://img.shields.io/npm/dw/pipeline-project-tool.svg)](https://npmjs.org/package/pipeline-project-tool)
[![License](https://img.shields.io/npm/l/pipeline-project-tool.svg)](https://github.com/stu-dev/pipeline-project-tool/blob/master/package.json)
# Usage
```sh-session
# Install as global package
$ npm install -g pipeline-project-tool
$ new-pipeline-project

OR

$ npx pipeline-project-tool
```
```sh-session
# Available options

## Print logs
-v|--verbose 

## Display version
-V|--version
```

# Output
- CodeCommit repository
- CodePipeline (using cdk pipelines)
  - Stag stage
  - Prod stage (with manual approval step)
  - Deploys skeleton lambda stack with scheduled expresion
