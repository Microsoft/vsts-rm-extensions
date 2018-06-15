﻿import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline'
var crypto = require('crypto');

var tl = require('vsts-task-lib/task');

import * as models from '../Models';
import * as ci from './cilogger';
import { ArtifactItemStore } from '../Store/artifactItemStore';
import { ArtifactEngineOptions } from "./artifactEngineOptions"
import { Logger } from './logger';
import { Worker } from './worker';
import { TicketState } from '../Models/ticketState';
import { CacheProvider } from '../Providers/cacheProvider';

export class ArtifactEngine {
    processItems(sourceProvider: models.IArtifactProvider, destProvider: models.IArtifactProvider, artifactEngineOptions?: ArtifactEngineOptions): Promise<models.ArtifactDownloadTicket[]> {
        var artifactDownloadTicketsPromise = new Promise<models.ArtifactDownloadTicket[]>((resolve, reject) => {
            const workers: Promise<void>[] = [];
            artifactEngineOptions = artifactEngineOptions || new ArtifactEngineOptions();
            artifactEngineOptions.artifactCacheDirectory = artifactEngineOptions.artifactCacheDirectory ? artifactEngineOptions.artifactCacheDirectory : tl.getVariable("AGENT_WORKFOLDER");
            this.createPatternList(artifactEngineOptions);
            var artifactName = sourceProvider.getRootItemPath();
            this.artifactItemStore = new ArtifactItemStore();
            this.artifactItemStore.flush();
            Logger.verbose = artifactEngineOptions.verbose;
            this.logger = new Logger(this.artifactItemStore);
            this.logger.logProgress();
            sourceProvider.artifactItemStore = this.artifactItemStore;
            destProvider.artifactItemStore = this.artifactItemStore;
            this.cacheProvider = new CacheProvider(artifactEngineOptions.artifactCacheDirectory,artifactEngineOptions.artifactCacheKey,artifactName);
            sourceProvider.getRootItems().then((itemsToProcess: models.ArtifactItem[]) => {
                this.artifactItemStore.addItems(itemsToProcess);
                this.createNewHashMap(sourceProvider,itemsToProcess).then(() => {
                    for (let i = 0; i < artifactEngineOptions.parallelProcessingLimit; ++i) {
                        var worker = new Worker<models.ArtifactItem>(i + 1, item => this.processArtifactItem(sourceProvider, item, destProvider, artifactEngineOptions), () => this.artifactItemStore.getNextItemToProcess(), () => !this.artifactItemStore.itemsPendingProcessing());
                        workers.push(worker.init());
                    }
        
                    Promise.all(workers).then(() => {
                        this.logger.logSummary();
                        
                        var destination = destProvider.getRootLocation();
                        var artifactName = sourceProvider.getRootItemPath();                        
                        var cachePath = this.cacheProvider.getCacheDirectory();
                        if(fs.existsSync(cachePath)) {
                            tl.rmRF(cachePath);
                        }
                        var self = this;
                        var cacheValidator = false;
                        this.walk(path.join(destination,artifactName), function (err, result) {                                                                        
                            if (err) {
                                throw err;
                            }
                            else {
                                var generateHashPromises = self.updateCache(result, destination, artifactName, self, cachePath,cacheValidator);
                                Promise.all(generateHashPromises).then(() => {
                                    self.cacheValidation(sourceProvider, destProvider, self, cachePath, resolve, cacheValidator);
                                });
                            };
                        });                                                            
                    }, (err) => {
                        ci.publishEvent('reliability', <ci.IReliabilityData>{ issueType: 'error', errorMessage: JSON.stringify(err, Object.getOwnPropertyNames(err)) });
                        sourceProvider.dispose();
                        destProvider.dispose();
                        reject(err);
                    });
                });
            }, (err) => {
                ci.publishEvent('reliability', <ci.IReliabilityData>{ issueType: 'error', errorMessage: JSON.stringify(err, Object.getOwnPropertyNames(err)) });
                sourceProvider.dispose();
                destProvider.dispose();
                reject(err);
            });
        });

        return artifactDownloadTicketsPromise;
    }

    processArtifactItem(sourceProvider: models.IArtifactProvider, 
        item: models.ArtifactItem,
        destProvider: models.IArtifactProvider,
        artifactEngineOptions: ArtifactEngineOptions): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.processArtifactItemImplementation(sourceProvider, item, destProvider, artifactEngineOptions, resolve, reject);
        });
    }

    processArtifactItemImplementation(sourceProvider: models.IArtifactProvider,
        item: models.ArtifactItem,
        destProvider: models.IArtifactProvider,
        artifactEngineOptions: ArtifactEngineOptions,
        resolve,
        reject,
        retryCount?: number) {
        var retryIfRequired = (err) => {
            if (retryCount === artifactEngineOptions.retryLimit - 1) {
                this.artifactItemStore.updateState(item, models.TicketState.Failed);
                reject(err);
            } else {
                this.artifactItemStore.increaseRetryCount(item);
                Logger.logMessage(tl.loc("RetryingDownload", item.path, (retryCount + 1)));
                setTimeout(() => this
                    .processArtifactItemImplementation(sourceProvider, item, destProvider, artifactEngineOptions, resolve, reject, retryCount + 1), artifactEngineOptions.retryIntervalInSeconds * 1000);
            }
        }
        retryCount = retryCount ? retryCount : 0;
        if (item.itemType === models.ItemType.File) {
            var pathToMatch = item.path.replace(/\\/g, '/');
            var matchOptions = {
                debug: false,
                nobrace: true,
                noglobstar: false,
                dot: true,
                noext: false,
                nocase: false,
                nonull: false,
                matchBase: false,
                nocomment: false,
                nonegate: false,
                flipNegate: false
            };

            if (tl.match([pathToMatch], this.patternList, null, matchOptions).length > 0) {
                Logger.logInfo("Processing " + item.path);
                var downloadedFromCache = false;
                var getContentStream = new Promise<NodeJS.ReadableStream>((resolve,reject) => {
                    this.cacheProvider.getArtifactItem(item).then((contentStream) => {
                        if(!contentStream) {
                            Logger.logMessage(tl.loc("SourceDownload",item.path));
                            sourceProvider.getArtifactItem(item).then((contentStream) => {                        
                                Logger.logInfo("Got download stream for item: " + item.path);
                                resolve(contentStream);
                            });
                        }
                        else {
                            Logger.logMessage(tl.loc("CacheDownload",item.path));
                            downloadedFromCache = true;
                            resolve(contentStream);
                        }
                    });
                });

                getContentStream.then((contentStream) => {
                    destProvider.putArtifactItem(item, contentStream).then((item) => {
                        this.artifactItemStore.updateState(item, models.TicketState.Processed, downloadedFromCache);
                        resolve();
                    }, (err) => {
                        Logger.logInfo("Error placing file " + item.path + ": " + err);
                        retryIfRequired(err);                            
                    });
                }, (err) => {
                    Logger.logInfo("Error getting file " + item.path + ": " + err);
                    retryIfRequired(err);
                });                       
            }          
            else {
                Logger.logMessage(tl.loc("SkippingItem", pathToMatch));
                this.artifactItemStore.updateState(item, models.TicketState.Skipped);
                resolve();
            }
        }
        else {
            sourceProvider.getArtifactItems(item).then((items: models.ArtifactItem[]) => {
                items = items.map((value, index) => {
                    if (!value.path.toLowerCase().startsWith(item.path.toLowerCase())) {
                        value.path = path.join(item.path, value.path);
                    }

                    return value;
                });

                this.artifactItemStore.addItems(items);
                this.artifactItemStore.updateState(item, models.TicketState.Processed);

                Logger.logInfo("Enqueued " + items.length + " for processing.");
                resolve();
            }, (err) => {
                Logger.logInfo("Error getting " + item.path + ":" + err);
                retryIfRequired(err);
            });
        }
    }

    createPatternList(artifactEngineOptions: ArtifactEngineOptions) {
        if (!artifactEngineOptions.itemPattern) {
            this.patternList = ['**'];
        }
        else {
            this.patternList = artifactEngineOptions.itemPattern.split('\n');
        }
    }

    createNewHashMap(sourceProvider: models.IArtifactProvider, itemsToProcess: models.ArtifactItem[]): Promise<string> {
        return new Promise((resolve,reject) => {
            sourceProvider.getArtifactItems(itemsToProcess[0]).then((items: models.ArtifactItem[]) => {
                sourceProvider.getArtifactItem(items.find(x => x.path === path.join(itemsToProcess[0].path, 'artifact-metadata.csv') )).then((hashStream : NodeJS.ReadableStream) => {                        
                    var newHashPromise = new Promise((resolve) => {
                        var newHash = readline.createInterface ({
                            input : hashStream
                        });
                
                        newHash.on('line', (line) => {
                            var words = line.split(',');
                            this.newHashMap[words[0]] = words[1];
                        });
            
                        newHash.on('close', () => {
                            resolve();
                        });
                    });
                    newHashPromise.then(() => {
                        this.artifactItemStore.setHashMap(this.newHashMap)
                        resolve();                                   
                    });                            
                }, (err) => {
                    Logger.logError(err);
                    reject(err);
                });
            }, (err) => {
                Logger.logError(err);
                reject(err);
            });
        });
    }

    updateCache(result: string[], destination: string, artifactName: string, self, cachePath: string, cacheValidator: boolean): Promise<string>[] {
        var generateHashPromises = [];
        if(!fs.existsSync(path.dirname(cachePath))) {
            tl.mkdirP(path.dirname(cachePath));
        }
        tl.mkdirP(cachePath);                                                                            
        result.forEach(function (file) {                                         
            var fileRelativePath = file.substring(path.join(destination,artifactName,'/').length);
            var fileCachePath = path.join(cachePath,fileRelativePath);
            if(!fs.existsSync(path.dirname(fileCachePath))) {                                
                tl.mkdirP(path.dirname(fileCachePath))
            }                                               
            var res = self.generateHash(file,fileCachePath).then(function (hash) {
                if(self.newHashMap[fileRelativePath] && self.newHashMap[fileRelativePath] !== hash) {
                    cacheValidator = true;
                }
            });                                        
            generateHashPromises.push(res);    
        });
        return generateHashPromises;
    }

    cacheValidation(sourceProvider: models.IArtifactProvider, destProvider: models.IArtifactProvider, self, cachePath: string, resolve, cacheValidator: boolean) {
        if(!cacheValidator) {
            var verifyFile = fs.createWriteStream(path.join(cachePath,"verify.json"));
            verifyFile.write(JSON.stringify({lastUpdatedOn: new Date().toISOString()}), () => {
                sourceProvider.dispose();
                destProvider.dispose();
                verifyFile.close();  
                resolve(self.artifactItemStore.getTickets());
            });
            verifyFile.on('error',(err) => {
                Logger.logMessage(err);
            });                                          
        }
        else {                    
            Logger.logMessage(tl.loc("UnsuccessfulValidation"))
            tl.rmRF(cachePath);
            resolve(self.artifactItemStore.getTickets());                                       
        }
    }

    walk(dir: string, done) {
        var self = this;
        var results = [];
        fs.readdir(dir, function (err, list) {
            if (err) {
                return done(err);
            }
            var pending = list.length;
            if (!pending) {
                return done(null, results);
            }
            list.forEach(function (file) {
                file = path.resolve(dir, file);
                fs.stat(file, function (err, stat) {
                    if (stat && stat.isDirectory()) {
                        self.walk(file, function (err, res) {                  
                            results = results.concat(res);
                            if (!--pending) {
                                done(null, results);
                            }
                        });
                    }
                    else {                        
                        results.push(file);
                        if (!--pending) {
                            done(null, results);
                        }
                    }
                });
            });
        });
    }
    
    generateHash(file: string, cachePath: string ) {
        return new Promise((resolve) => {
            var hash = "";
            var hashInterface = crypto.createHash('sha256');
            var wstream = fs.createWriteStream(cachePath);
            var stream = fs.createReadStream(file);
            stream.on('data', function (data) {
                wstream.write(data);
                wstream.on('error', (err) => {
                    throw err;
                });
                hashInterface.update(data, 'utf8');                
            });
            stream.on('end', function () {
                wstream.close();
                hash = hashInterface.digest('hex').toUpperCase();
                resolve(hash);
            });
        })        
    }    

    private artifactItemStore: ArtifactItemStore;
    private logger: Logger;
    private cacheProvider: CacheProvider;
    private patternList: string[];
    private newHashMap = {};
}

tl.setResourcePath(path.join(path.dirname(__dirname), 'lib.json'));
process.on('unhandledRejection', (err) => {
    ci.publishEvent('reliability', <ci.IReliabilityData>{ issueType: 'unhandledRejection', errorMessage: JSON.stringify(err, Object.getOwnPropertyNames(err)) });
    Logger.logError(tl.loc("UnhandledRejection", err));
    throw err;
});

process.on('uncaughtException', (err) => {
    ci.publishEvent('reliability', <ci.IReliabilityData>{ issueType: 'uncaughtException', errorMessage: JSON.stringify(err, Object.getOwnPropertyNames(err)) });
    Logger.logError(tl.loc("UnhandledException", err));
    throw err;
});