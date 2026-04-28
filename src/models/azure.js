import { AzureOpenAI } from "openai";
import { getKey, hasKey } from '../utils/keys.js';
import { GPT } from './gpt.js'
import { resolveKeyName, sanitizeRequestParams } from './_model_utils.js';

export class AzureGPT extends GPT {
    static prefix = 'azure';
    constructor(model_name, url, params, keyName) {
        const defaultKeyName = hasKey('AZURE_OPENAI_API_KEY') ? 'AZURE_OPENAI_API_KEY' : 'OPENAI_API_KEY';
        const resolvedKeyName = resolveKeyName(params, keyName, defaultKeyName);
        super(model_name, url, params, resolvedKeyName)

        this.model_name = model_name;
        this.params = sanitizeRequestParams(params);

        const config = {};

        if (url)
            config.endpoint = url;

        config.apiKey = getKey(resolvedKeyName);

        config.deployment = model_name;

        if (this.params.apiVersion) {
            config.apiVersion = this.params.apiVersion;
            delete this.params.apiVersion; // remove from params for later use in requests
        }
        else {
            throw new Error('apiVersion is required in params for azure!');
        }

        this.openai = new AzureOpenAI(config)
    }
}
