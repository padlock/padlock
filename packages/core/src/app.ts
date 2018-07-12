import { LocalStorage, RemoteStorage } from "./storage";
import { Store, MainStore, SharedStore, Record, Field, Tag } from "./data";
import { Account, Session } from "./auth";
import { DateString } from "./encoding";
import { Client } from "./client";
import { Messages } from "./messages";
import { localize as $l } from "./locale";
import { ErrorCode } from "./error";

export interface Stats {
    [key: string]: string | number | boolean;
}

export interface Settings {
    autoLock: boolean;
    autoLockDelay: number;
    defaultFields: string[];
    customServer: boolean;
    customServerUrl: string;
    autoSync: boolean;
}

const defaultSettings: Settings = {
    autoLock: true,
    autoLockDelay: 5,
    defaultFields: ["username", "password"],
    customServer: false,
    customServerUrl: "https://cloud.padlock.io/",
    autoSync: true
};

export class App extends EventTarget {
    storageKind: "padlock-app";
    storageKey: "";

    version = "3.0";
    storage = new LocalStorage();
    client = new Client(this);
    remoteStorage = new RemoteStorage(this.client);
    mainStore = new MainStore();
    sharedStores: SharedStore[] = [];
    settings = defaultSettings;
    messages = new Messages("https://padlock.io/messages.json");
    locked = true;
    stats: Stats = {};

    initialized?: DateString;
    account?: Account;
    session?: Session;

    loaded = this.load();

    async serialize() {
        return {
            account: this.account,
            session: this.session,
            initialized: this.initialized,
            stats: this.stats,
            messages: await this.messages.serialize(),
            settings: this.settings
        };
    }

    async deserialize(raw: any) {
        this.account = raw.account && (await new Account().deserialize(raw.account));
        this.session = raw.session && (await new Session().deserialize(raw.session));
        this.initialized = raw.initialized;
        this.setStats(raw.stats || {});
        await this.messages.deserialize(raw.messages);
        this.setSettings(raw.settings);
        return this;
    }

    dispatch(eventName: string, detail?: any) {
        this.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    }

    async load() {
        try {
            await this.storage.get(this);
        } catch (e) {
            await this.storage.set(this);
        }
        this.dispatch("load");
    }

    get password(): string | undefined {
        return this.mainStore.password;
    }

    set password(pwd: string | undefined) {
        this.mainStore.password = pwd;
    }

    async setStats(obj: Partial<Stats>) {
        Object.assign(this.stats, obj);
        this.storage.set(this);
        this.dispatch("stats-changed", { stats: this.stats });
    }

    async setSettings(obj: Partial<Settings>) {
        Object.assign(this.settings, obj);
        this.storage.set(this);
        this.dispatch("settings-changed", { settings: this.settings });
    }

    async initialize(password: string) {
        await this.setPassword(password);
        this.initialized = new Date().toISOString();
        await this.storage.set(this);
        this.dispatch("initialize");
        this.dispatch("unlock");
    }

    async unlock(password: string) {
        this.mainStore.password = password;
        await this.storage.get(this.mainStore);
        this.locked = false;
        this.dispatch("unlock");

        // for (const id of this.account!.sharedStores) {
        //     const sharedStore = new SharedStore(id);
        //     sharedStore.account = this.account!;
        //     sharedStore.privateKey = this.privateKey!;
        //     try {
        //         await this.storage.get(sharedStore);
        //         this.sharedStores.push(sharedStore);
        //     } catch (e) {
        //         console.error("Failed to decrypt shared store with id", sharedStore.id, e);
        //     }
        // }
    }

    async lock() {
        await Promise.all([this.mainStore.clear(), ...this.sharedStores.map(s => s.clear())]);
        this.sharedStores = [];
        this.locked = true;
        this.dispatch("lock");
    }

    async setPassword(password: string) {
        this.password = password;
        await this.storage.set(this.mainStore);
        this.dispatch("password-changed");
    }
    //
    // async createSharedStore(): Promise<SharedStore> {
    //     const store = new SharedStore();
    //     store.account = this.account!;
    //     store.privateKey = this.privateKey;
    //     await store.addMember(this.account!);
    //     await this.storage.set(store);
    //     this.sharedStores.push(store);
    //     this.account!.sharedStores.push(store.id);
    //     await this.storage.set(this.mainStore);
    //     return store;
    // }

    async save() {
        return Promise.all([
            this.storage.set(this),
            this.storage.set(this.mainStore),
            ...this.sharedStores.map(s => this.storage.set(s))
        ]);
    }

    async reset() {
        await this.lock();
        await this.storage.clear();
        delete this.account;
        delete this.session;
        delete this.initialized;
        this.dispatch("reset");
        this.loaded = this.load();
    }

    async addRecords(store: Store, records: Record[]) {
        store.addRecords(records);
        await this.storage.set(store);
        this.dispatch("records-added", { store: store, records: records });
    }

    async createRecord(store: Store, name: string): Promise<Record> {
        const fields = [
            { name: $l("Username"), value: "", masked: false },
            { name: $l("Password"), value: "", masked: true }
        ];
        const record = store.createRecord(name || "", fields);
        await this.addRecords(store, [record]);
        this.dispatch("record-created", { store: store, record: record });
        return record;
    }

    async updateRecord(store: Store, record: Record, upd: { name?: string; fields?: Field[]; tags?: Tag[] }) {
        for (const prop of ["name", "fields", "tags"]) {
            if (typeof upd[prop] !== "undefined") {
                record[prop] = upd[prop];
            }
        }
        record.updated = new Date();
        await this.storage.set(store);
        this.dispatch("record-changed", { store: store, record: record });
    }

    async deleteRecords(store: Store, records: Record | Record[]) {
        store.removeRecords(records);
        await this.storage.set(store);
        this.dispatch("records-deleted", { store: store, records: records });
    }

    async login(email: string) {
        await this.client.createSession(email);
        await this.storage.set(this);
        this.dispatch("login");
        this.dispatch("account-changed", { account: this.account });
        this.dispatch("session-changed", { session: this.session });
    }

    async activateSession(code: string) {
        await this.client.activateSession(code);
        await this.client.getAccount();
        await this.storage.set(this);
        this.dispatch("account-changed", { account: this.account });
        this.dispatch("session-changed", { session: this.session });
    }

    async revokeSession(id: string) {
        await this.client.revokeSession(id);
        await this.client.getAccount();
        await this.storage.set(this);
        this.dispatch("account-changed", { account: this.account });
    }

    async refreshAccount() {
        await this.client.getAccount();
        await this.storage.set(this);
        this.dispatch("account-changed", { account: this.account });
    }

    async logout() {
        await this.client.logout();
        delete this.session;
        delete this.account;
        await this.storage.set(this);
        this.dispatch("logout");
        this.dispatch("account-changed", { account: this.account });
        this.dispatch("session-changed", { session: this.session });
    }

    async hasRemoteData(): Promise<boolean> {
        try {
            await this.client.request("GET", "store/main/");
            return true;
        } catch (e) {
            if (e.code === ErrorCode.NOT_FOUND) {
                return false;
            }
            throw e;
        }
    }

    async synchronize() {
        try {
            await this.remoteStorage.get(this.mainStore);
        } catch (e) {
            console.log("error", e.code);
            if (e.code !== ErrorCode.NOT_FOUND) {
                throw e;
            }
        }

        await Promise.all([this.storage.set(this.mainStore), this.remoteStorage.set(this.mainStore)]);

        this.dispatch("synchronize");
    }

    async reactivateSubscription() {}

    buySubscription(_source: string) {}

    cancelSubscription() {}

    updatePaymentMethod(_source: String) {}
}