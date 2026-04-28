import { cosineSimilarity } from './math.js';
import { stringifyTurns, wordOverlapScore } from './text.js';

export class Examples {
    constructor(model, select_num=2) {
        this.examples = [];
        this.model = model;
        this.select_num = select_num;
        this.embeddings = {};
    }

    turnsToText(turns) {
        let messages = '';
        for (let turn of turns) {
            if (turn.role !== 'assistant')
                messages += turn.content.substring(turn.content.indexOf(':')+1).trim() + '\n';
        }
        return messages.trim();
    }

    async load(examples) {
        this.examples = examples;
        if (!this.model) return; // Early return if no embedding model
        
        if (this.select_num === 0)
            return;

        try {
            // Create array of promises first
            const embeddingPromises = examples.map(example => {
                const turn_text = this.turnsToText(example);
                return this.model.embed(turn_text)
                    .then(embedding => {
                        this.embeddings[turn_text] = embedding;
                    });
            });
            
            // Wait for all embeddings to complete
            await Promise.all(embeddingPromises);
        } catch (err) {
            console.warn('Error with embedding model, using word-overlap instead.');
            this.model = null;
        }
    }

    async getRelevant(turns) {
        if (this.select_num === 0)
            return [];

        let turn_text = this.turnsToText(turns);
        const sortByWordOverlap = () => {
            this.examples.sort((a, b) => 
                wordOverlapScore(turn_text, this.turnsToText(b)) -
                wordOverlapScore(turn_text, this.turnsToText(a))
            );
        };

        if (this.model !== null) {
            try {
                if (turn_text.length === 0) {
                    throw new Error('Empty text cannot be embedded.');
                }
                let embedding = await this.model.embed(turn_text);
                this.examples.sort((a, b) => {
                    const bEmbedding = this.embeddings[this.turnsToText(b)];
                    const aEmbedding = this.embeddings[this.turnsToText(a)];
                    if (!bEmbedding || !aEmbedding) {
                        return 0;
                    }
                    return cosineSimilarity(embedding, bEmbedding) -
                        cosineSimilarity(embedding, aEmbedding);
                });
            } catch (err) {
                console.warn('Error with embedding model during example selection, using word-overlap instead.', err?.message || err);
                this.model = null;
                sortByWordOverlap();
            }
        }
        else {
            sortByWordOverlap();
        }
        let selected = this.examples.slice(0, this.select_num);
        return JSON.parse(JSON.stringify(selected)); // deep copy
    }

    async createExampleMessage(turns) {
        let selected_examples = await this.getRelevant(turns);

        console.log('selected examples:');
        for (let example of selected_examples) {
            console.log('Example:', example[0].content)
        }

        let msg = 'Examples of how to respond:\n';
        for (let i=0; i<selected_examples.length; i++) {
            let example = selected_examples[i];
            msg += `Example ${i+1}:\n${stringifyTurns(example)}\n\n`;
        }
        return msg;
    }
}