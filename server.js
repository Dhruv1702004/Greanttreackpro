const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
// Public folder se files serve karega
app.use(express.static('public')); 

// Database Connection
const db = new sqlite3.Database(path.join(__dirname, 'granttrack.db'), (err) => {
    if (err) console.error("Database connection error:", err);
    else console.log("Database se connection ho gaya!");
});

// Table Initialize
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS schools (
        id TEXT PRIMARY KEY,
        name TEXT,
        code TEXT,
        block TEXT,
        cluster TEXT,
        princ TEXT,
        addr TEXT,
        bankName TEXT,
        accountNo TEXT,
        ifsc TEXT,
        branch TEXT,
        grantType TEXT,
        entries TEXT,
        savedAt TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS master_data (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cashbook_entries (
        id TEXT PRIMARY KEY,
        mod TEXT,
        reg TEXT,
        side TEXT,
        date TEXT,
        f1 TEXT,
        f2 TEXT,
        f3 TEXT,
        txt TEXT,
        ex TEXT,
        savedAt TEXT
    )`);
});

function parseJson(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        return fallback;
    }
}

function getMasterValue(key, fallback) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT value FROM master_data WHERE key = ?`, [key], (err, row) => {
            if (err) return reject(err);
            resolve(row ? parseJson(row.value, fallback) : fallback);
        });
    });
}

function setMasterValue(key, value) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR REPLACE INTO master_data (key, value, updatedAt) VALUES (?, ?, ?)`,
            [key, JSON.stringify(value), new Date().toISOString()],
            function(err) {
                if (err) return reject(err);
                resolve();
            }
        );
    });
}

function removeMasterValues() {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM master_data`, [], function(err) {
            if (err) return reject(err);
            resolve();
        });
    });
}

// API: Save School Data
app.post('/api/save-school', (req, res) => {
    const s = req.body;
    const entriesStr = JSON.stringify(s.entries || []);
    
    const sql = `INSERT OR REPLACE INTO schools (id, name, code, block, cluster, princ, addr, bankName, accountNo, ifsc, branch, grantType, entries, savedAt) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [s.id, s.name, s.code, s.block, s.cluster, s.princ, s.addr, s.bankName, s.accountNo, s.ifsc, s.branch, s.grantType, entriesStr, s.savedAt], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: "Database save error" });
        }
        res.json({ success: true, id: s.id });
    });
});

// API: Get All Records
app.get('/api/records', (req, res) => {
    Promise.all([
        getMasterValue('school', null),
        getMasterValue('bank', null),
        getMasterValue('grants', []),
        new Promise((resolve, reject) => {
            db.all(`SELECT * FROM cashbook_entries ORDER BY savedAt DESC`, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        })
    ]).then(([school, bank, grants, cashbookRows]) => {
        if (school && (school.name || school.dise)) {
            const grantEntries = grants.map(item => ({
                id: item.id,
                amount: item.amount,
                section: item.module === 'SMC' ? 'SMC' : 'Education',
                ifsc: bank ? bank.ifsc : '',
                source: 'grant-master',
                head: item.head,
                date: item.date
            }));

            const cashbookEntries = cashbookRows.map(item => ({
                id: item.id,
                amount: parseFloat(item.f3 || 0),
                section: item.mod === 'smc' ? 'SMC' : 'Education',
                ifsc: bank ? bank.ifsc : '',
                source: item.reg,
                head: item.f2,
                date: item.date
            }));

            return res.json({
                records: [{
                    id: school.id || school.dise || 'active-school',
                    name: school.name || '',
                    code: school.dise || '',
                    block: school.block || '',
                    cluster: school.cluster || '',
                    princ: school.paycenter || '',
                    addr: school.taluka || '',
                    bankName: bank ? bank.name : '',
                    accountNo: bank ? bank.accNo : '',
                    ifsc: bank ? bank.ifsc : '',
                    branch: bank ? bank.type : '',
                    grantType: 'SQLite Master',
                    entries: [...grantEntries, ...cashbookEntries],
                    savedAt: new Date().toISOString()
                }]
            });
        }

        db.all(`SELECT * FROM schools ORDER BY savedAt DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ records: [] });

            const formattedRecords = rows.map(row => ({
                ...row,
                entries: parseJson(row.entries, [])
            }));
            res.json({ records: formattedRecords });
        });
    }).catch(error => {
        console.error(error);
        res.status(500).json({ records: [] });
    });
});

app.get('/api/master', async (req, res) => {
    try {
        const [school, bank, grants] = await Promise.all([
            getMasterValue('school', null),
            getMasterValue('bank', null),
            getMasterValue('grants', [])
        ]);
        res.json({ school, bank, grants });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Master data load error' });
    }
});

app.put('/api/master/school', async (req, res) => {
    try {
        const school = {
            id: req.body.id || req.body.dise || 'active-school',
            name: req.body.name || '',
            dise: req.body.dise || req.body.code || '',
            block: req.body.block || '',
            cluster: req.body.cluster || '',
            paycenter: req.body.paycenter || '',
            taluka: req.body.taluka || '',
            savedAt: new Date().toISOString()
        };
        await setMasterValue('school', school);
        res.json({ success: true, school });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'School save error' });
    }
});

app.put('/api/master/bank', async (req, res) => {
    try {
        const bank = {
            name: req.body.name || '',
            type: req.body.type || '',
            accNo: req.body.accNo || '',
            ifsc: req.body.ifsc || '',
            savedAt: new Date().toISOString()
        };
        await setMasterValue('bank', bank);
        res.json({ success: true, bank });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Bank save error' });
    }
});

app.post('/api/master/grants', async (req, res) => {
    try {
        const grants = await getMasterValue('grants', []);
        const grant = {
            id: String(req.body.id || Date.now()),
            date: req.body.date || '',
            module: req.body.module || 'PFMS',
            head: req.body.head || '',
            amount: parseFloat(req.body.amount || 0),
            savedAt: new Date().toISOString()
        };
        grants.push(grant);
        await setMasterValue('grants', grants);
        res.json({ success: true, grant, grants });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Grant save error' });
    }
});

app.delete('/api/master/grants/:id', async (req, res) => {
    try {
        const grants = await getMasterValue('grants', []);
        const filtered = grants.filter(item => String(item.id) !== String(req.params.id));
        await setMasterValue('grants', filtered);
        res.json({ success: true, grants: filtered });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Grant delete error' });
    }
});

app.delete('/api/master', async (req, res) => {
    try {
        await removeMasterValues();
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Master clear error' });
    }
});

app.get('/api/cashbook-records', (req, res) => {
    db.all(`SELECT * FROM cashbook_entries ORDER BY savedAt ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ records: [] });
        res.json({ records: rows || [] });
    });
});

app.post('/api/cashbook-records', (req, res) => {
    const r = req.body;
    const record = {
        id: String(r.id || Date.now()),
        mod: r.mod || '',
        reg: r.reg || '',
        side: r.side || '',
        date: r.date || '',
        f1: r.f1 || '',
        f2: r.f2 || '',
        f3: r.f3 || '',
        txt: r.txt || '',
        ex: r.ex || '',
        savedAt: new Date().toISOString()
    };

    db.run(
        `INSERT OR REPLACE INTO cashbook_entries (id, mod, reg, side, date, f1, f2, f3, txt, ex, savedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.id, record.mod, record.reg, record.side, record.date, record.f1, record.f2, record.f3, record.txt, record.ex, record.savedAt],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: 'Cashbook save error' });
            res.json({ success: true, record });
        }
    );
});

app.delete('/api/cashbook-records/:id', (req, res) => {
    db.run(`DELETE FROM cashbook_entries WHERE id = ?`, [String(req.params.id)], function(err) {
        if (err) return res.status(500).json({ success: false, error: 'Cashbook delete error' });
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Ab login ki zarurat nahi hai, project seedha chalu hoga!');
});
