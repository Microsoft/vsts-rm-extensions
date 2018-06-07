# Incremental Download

## Overview
The feature is to allow Incremental Download of the Artifact in release so that all of the artifact items are not downloaded from the source provider and can be retrieved from a pre-maintained cache as well.

## Task Changes
Ideally we should be given the hashes of the files from the service itself but since services like Jenkins and Teamcity do not provide such hashes, we needed some generic way to get the hashes.

A new task will be created named `Generate Artifact Metadata` that will generate `artifact-metadata.csv` file containing the filepaths and hashes of artifact items mapped to one another, created in the same directory as that of the artifacts.

Currently, it supports VSTS but similar tasks can be written for Jenkins and teamcity as well. 

##### artifact-metadata.csv example
![Alt text](./artifact-metadata(.csv).png?raw=true "Title")

## Artifact Engine Changes
A CacheProvider will be initialized with a “Hash” that reads the old artifact-metadata.csv

#### PsuedoCode
```
  If(deploymentInput.enableIncrementalDownload is false)
	{
		//download all the artifacts
		Return releasedefinition.Artifacts;
	}
  Else
	{
		//download the artifacts incrementally
    		Initialize cache by reading the hash of artifact type.
		If(artifactItem is in cache)
		{
			//download from the cache
			Return cache.artifactItem;
		}
		Else
		{
			//download from the sourceProvider
			Return sourceProvider.artifactItem;
		}
	}
```

A new cache directory will be generated by the artifact engine under the folder _work\ArtifactEngineCache\SHA256HashofArtifact\ where the hash will be calculated by the following keys corresponding to different artifact types:
- Keys:
  - Build Artifacts : CollectionID.ProjectID.buildDefinitionID
  - Jenkins Artifacts : JenkinsURL.JobID
  - TeamCity Artifacts : teamCityURL.BuildConfigurationID

The new  artifact-metadata.csv will be read by artifact engine and the hashes will be stored in the artifactItemStore along with the artifactItems.

When worker call getItems to retrieve an item, cacheProvider will be called to check whether that item is present in cache or not. If yes, then item will be fetched from the cache otherwise from the sourceProvider itself.

Finally, when all the files are put to the desired destination, they will be copied to the appropriate cache location based on the hash calculated, to update the cache.

An additional .verify file will also be generated to check the correctness of the cache(i.e. whether the cache has been successfully updated or it failed in between).

Validation(checking if the hash of the downloaded files matches the hash in the corresponding artifact-metadata.csv file) of the downloaded files will be done while copying them to the cache with the option to skip the validation step.


## UI Changes
New task : Generate Artifact Metadata is created.

In Download Build Artifact Task: under advanced options, there will be an option to enable Incremental Download.

Also, while linking Artifact during Release definition an option will be provided for incrementally downloading the artifact.