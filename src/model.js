/**
 * Module containing logic for records, collections and the data store.
 */
define(["padlock/crypto", "padlock/util"], function(crypto, util) {
    /**
     * The _Store_ acts as a proxy between the persistence layer (e.g. _LocalStorageSource_)
     * and a _Collection_ object it mainly handles encryption and decryption of data
     * @param Object defaultSource Default source to be used for _fetch_, _save_ etc.
     */
    var Store = function(defaultSource) {
        this.defaultSource = defaultSource;
        this.password = "";
    };

    Store.prototype = {
        getKey: function(coll) {
            return "coll_" + coll.name;
        },
        /**
         * Fetches the data for an array from local storage, decrypts it and populates the collection
         * @param  {Collection} coll     The collection to fetch the data for
         * @param  {Object}     opts     Object containing options for this call. Options may include:
         * 
         * - password: Password to be used for decryption. If not provided,
         *                        the stores own _password_ property will be used
         * - success:  Success callback
         * - fail:     Fail callback. The call will fail if 
         *             a) retrieving the data from the source fails,
         *             b) the encrypted data is corrupted or
         *             c) the provided password is incorrect.
         * - source:   Source to use for retreiving the data. If not provided, _defaultSource_ is used. 
         */
        fetch: function(coll, opts) {
            opts = opts || {};
            source = opts.source || this.defaultSource;
            // Use password argument if provided, otherwise use _this.password_
            var password = opts.password !== undefined && opts.password !== null ? opts.password : this.password,
                key = this.getKey(coll);

            source.fetch({key: key, success: function(data) {
                // Try to decrypt and parse data. This might fail either if the password
                // is incorrect or the data corrupted. If the decryption is successful, the parsing
                // should usually be no problem.
                try {
                    var records = JSON.parse(crypto.pwdDecrypt(password, data));
                    coll.add(records);
                    if (opts.success) {
                        opts.success(coll);
                    }
                } catch (e) {
                    if (opts.fail) {
                        opts.fail(e);
                    }
                }
            }, fail: opts.fail});

            // Remember the password for next time we save or fetch data
            this.password = password;
        },
        /**
         * Encrypts the contents of a collection and saves them to local storage.
         * @param  {Collection} coll Collection to save
         * @param  {Object}     opts Object containing options for the call. Options may include:
         *
         * - success:  Success callback
         * - fail:     Fail callback
         * - source:   Source to store the data to. If not provided, _defaultSource_ is used. 
         */
        save: function(coll, opts) {
            opts = opts || {};
            source = opts.source || this.defaultSource;
            // Stringify the collections record array
            var pt = JSON.stringify(coll.records);
            // Encrypt the JSON string
            var c = crypto.pwdEncrypt(this.password, pt);
            opts.key = this.getKey(coll);
            opts.data = c;
            source.save(opts);
        },
        /**
         * Checks whether or not data for a collection exists in localstorage
         * @param  {Collection} coll Collection to check for
         * @param  {Object}     opts Object containing options for the call. Options may include:
         *
         * - success:  Success callback. Will be passed _true_ or _false_ as only argument,
         *             depending on the outcome.
         * - fail:     Fail callback
         * - source:   Source to check for the collection. If not provided, _defaultSource_ is used. 
         */
        exists: function(coll, opts) {
            source = opts.source || this.defaultSource;
            opts = opts || {};
            opts.key = this.getKey(coll);
            source.exists(opts);
        }
    };

    /**
     * A collection of records
     * @param {String} name    Name of the collection
     * @param {Store}  store   Store instance to be used. If not provided,
     *                         a new instance will be created.
     */
    var Collection = function(name, store) {
        this.name = name || "default";
        this.store = store || new Store();
        this.records = [];
        // This is to keep track of all existing records via their uuid.
        this.uuidMap = {};
    };

    Collection.prototype = {
        /**
         * Fetches the data for this collection
         * @param {Object} opts Object containing options for the call. Options may include:
         * 
         * - password: Password to be used for decyrption
         * - success:  Success callback. Will be passed the collection as only argument
         * - fail:     Fail callback
         * - source:   Source to to be used. If not provided, the stores default source is used.
         */
        fetch: function(opts) {
            this.store.fetch(this, opts);
        },
        /**
         * Saves the collections contents
         * @param {Object} opts Object containing options for the call. Options may include:
         * 
         * - success:  Success callback. Will be passed the collection as only argument
         * - fail:     Fail callback
         * - source:   Source to to be used. If not provided, the stores default source is used.
         */
        save: function(opts) {
            var rec = opts && opts.record;
            if (rec) {
                rec.name = rec.name || "Unnamed";
                // Filter out fields that have neither a name nor a value
                rec.fields = rec.fields.filter(function(field) {
                    return field.name || field.value;
                });
                rec.updated = new Date();
            }
            this.store.save(this, opts);
        },
        /**
         * Adds a record or an array of records to the collection. If the record does not
         * have a _uuid_ yet, it will be generated. If two records with the same _uuid_ exist, i.e.
         * if one exists in the collection and one is added, the one with the more recent _updated_
         * property is used.
         * @param {Object}  rec A record object or an array of record objects to be added to the collection
         */
        add: function(rec) {
            var records = this.records.slice();

            rec = util.isArray(rec) ? rec : [rec];
            rec.forEach(function(r) {
                // Generate uuid if the record doesn't have one yet
                r.uuid = r.uuid || util.uuid();
                // If a record with the same uuid exists but the new one is more
                // recent, replace the existing one. Otherwise just add it.
                var existing = this.uuidMap[r.uuid];
                if (existing && r.updated && r.updated > existing.updated) {
                    this.uuidMap[r.uuid] = r;
                    records[records.indexOf(existing)] = r;
                } else if (!existing) {
                    this.uuidMap[r.uuid] = r;
                    records.push(r);
                }
            }.bind(this));

            this.records = records;
        },
        /**
         * Removes a record from this collection. This does not actually remove the record from
         * the _records_ array but instead removes all the information except the _uuid_ and sets
         * the _removed_ property to _true_. This makes it possible to synchronize deleting
         * records between sources.
         * @param  {Object} rec The record object to be removed
         */
        remove: function(rec) {
            for (var prop in rec) {
                if (rec.hasOwnProperty(prop) && prop != "uuid") {
                    delete rec[prop];
                }
            }
            rec.updated = new Date();
            rec.removed = true;
        },
        /**
         * Sets the new password for this collections store and saves the collection
         * @param {String} password New password
         */
        setPassword: function(password) {
            this.store.password = password;
            this.save();
        },
        /**
         * Checks whether or not data for the collection exists
         * @param  {Object}     opts Object containing options for the call. Options may include:
         *
         * - success:  Success callback. Will be passed _true_ or _false_ as only argument,
         *             depending on the outcome.
         * - fail:     Fail callback
         * - source:   Source to check for the collection. If not provided, _defaultSource_ is used. 
         */
        exists: function(opts) {
            this.store.exists(this, opts);
        },
        /**
         * Empties the collection and removes the stored password
         */
        lock: function() {
            this.records = [];
            this.store.password = null;
        },
        /**
         * Synchronizes the collection with a different source
         * @param  {Source} source The source to sync with
         * @param  {Object} opts   Object containing options. Options may include:
         *
         *                         - success: Success callback
         *                         - fail: Failure callback
         */
        sync: function(source, opts) {
            // Fetch data from remote source
            this.fetch({source: source, success: function() {
                // Save data to local source
                this.save({success: function() {
                    // Update remote source
                    this.save({source: source, success: function() {
                        // Done!
                        if (opts && opts.success) {
                            opts.success();
                        }
                    }.bind(this), fail: opts && opts.fail});
                }.bind(this), fail: opts && opts.fail});
            }.bind(this), fail: opts && opts.fail});
        }
    };

    return {
        Store: Store,
        Collection: Collection
    };
});