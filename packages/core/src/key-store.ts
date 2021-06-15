import { AsBytes, AsDate } from "./encoding";
import { Storable } from "./storage";
import { uuid } from "./util";

export class KeyStoreEntry extends Storable {
    id: string = "";

    @AsDate()
    created!: Date;

    accountId: string = "";

    authenticatorId: string = "";

    @AsBytes()
    data!: Uint8Array;

    constructor(init: Partial<KeyStoreEntry> = {}) {
        super();
        Object.assign(this, init);
    }

    async init() {
        this.id = await uuid();
        this.created = new Date();
    }
}

// export interface KeyStore {
//     set(value: string): Promise<string>;
//     get(id: string): Promise<string>;
//     delete(id: string): Promise<void>;
// }

// export class MemoryKeyStore {
//     private _data = new Map<string, string>();
//     async set(value: string) {
//         const id = await uuid();
//         this._data.set(id, value);
//         return id;
//     }

//     async get(id: string) {
//         return this._data.get(id);
//     }

//     async delete(id: string) {
//         this._data.delete(id);
//     }
// }
