(function (global) {
    "use strict";

    function s(value) {
        return value === null || value === undefined
            ? ""
            : String(value).trim();
    }

    function n(value) {
        if (value === null || value === undefined || value === "") return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    function positiveInt(value, fallback) {
        const num = Math.floor(Number(value));
        return Number.isFinite(num) && num > 0 ? num : fallback;
    }

    function numberLabel(value) {
        return Number(value || 0).toLocaleString("ja-JP");
    }

    function readKeywordMaster(dataset) {
        const rows = datasetObjects(dataset);
        const result = [];
        const seen = new Set();

        rows.forEach(row => {
            const keyword = s(row["仕事名KW"]);
            if (!keyword || seen.has(keyword)) return;
            seen.add(keyword);
            result.push(keyword);
        });

        return result;
    }

    function matchKeywords(jobName, keywords) {
        const text = s(jobName);

        if (!text || !keywords.length) {
            return { single: "（該当なし）", full: "（該当なし）" };
        }

        const lower = text.toLowerCase();
        const matched = [];

        keywords.forEach(keyword => {
            if (lower.includes(keyword.toLowerCase())) matched.push(keyword);
        });

        if (!matched.length) {
            return { single: "（該当なし）", full: "（該当なし）" };
        }

        return {
            single: matched[0],
            full: matched.join("＋")
        };
    }

    function truthy(value) {
        return (
            value === true ||
            value === 1 ||
            value === "1" ||
            String(value).toUpperCase() === "TRUE"
        );
    }

    function datasetObjects(dataset) {
        const headers = Array.isArray(dataset?.headers) ? dataset.headers : [];
        const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];

        return rows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] ?? "";
            });
            return obj;
        });
    }

    function parseDate(value) {
        if (!value) return null;

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value;
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            const epoch = new Date(1899, 11, 30, 0, 0, 0, 0).getTime();
            const d = new Date(epoch + value * 86400000);
            return Number.isNaN(d.getTime()) ? null : d;
        }

        const text = s(value);
        if (!text) return null;

        const match = text.match(
            /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
        );

        if (match) {
            const d = new Date(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4] || 0),
                Number(match[5] || 0),
                Number(match[6] || 0)
            );
            return Number.isNaN(d.getTime()) ? null : d;
        }

        const d = new Date(text);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function dateKey(date) {
        if (!date || Number.isNaN(date.getTime())) return null;
        return (
            date.getFullYear() * 10000 +
            (date.getMonth() + 1) * 100 +
            date.getDate()
        );
    }

    function ageBuckets(mode) {
        if (mode === "年代（5歳ずらし）") {
            return [
                "15-25歳",
                "26-35歳",
                "36-45歳",
                "46-55歳",
                "56-65歳",
                "66-75歳",
                "76-85歳",
                "その他"
            ];
        }

        return [
            "10代",
            "20代",
            "30代",
            "40代",
            "50代",
            "60代",
            "70代",
            "その他"
        ];
    }

    function ageBucket(age, mode) {
        const a = n(age);
        if (a === null) return "その他";

        if (mode === "年代（5歳ずらし）") {
            if (a >= 15 && a <= 25) return "15-25歳";
            if (a >= 26 && a <= 35) return "26-35歳";
            if (a >= 36 && a <= 45) return "36-45歳";
            if (a >= 46 && a <= 55) return "46-55歳";
            if (a >= 56 && a <= 65) return "56-65歳";
            if (a >= 66 && a <= 75) return "66-75歳";
            if (a >= 76 && a <= 85) return "76-85歳";
            return "その他";
        }

        if (a >= 10 && a <= 19) return "10代";
        if (a >= 20 && a <= 29) return "20代";
        if (a >= 30 && a <= 39) return "30代";
        if (a >= 40 && a <= 49) return "40代";
        if (a >= 50 && a <= 59) return "50代";
        if (a >= 60 && a <= 69) return "60代";
        if (a >= 70 && a <= 79) return "70代";
        return "その他";
    }

    function filteredAgeBucketDefinitions(mode, minAge, maxAge) {
        const min = n(minAge);
        const max = n(maxAge);
        const active = min !== null || max !== null;

        if (!active) {
            return ageBuckets(mode).map(label => ({ label, originalLabel: label }));
        }

        const base = mode === "年代（5歳ずらし）"
            ? [
                { min: 15, max: 25, label: "15-25歳" },
                { min: 26, max: 35, label: "26-35歳" },
                { min: 36, max: 45, label: "36-45歳" },
                { min: 46, max: 55, label: "46-55歳" },
                { min: 56, max: 65, label: "56-65歳" },
                { min: 66, max: 75, label: "66-75歳" },
                { min: 76, max: 85, label: "76-85歳" },
                { min: 86, max: null, label: "86歳以上" }
            ]
            : [
                { min: 10, max: 19, label: "10代" },
                { min: 20, max: 29, label: "20代" },
                { min: 30, max: 39, label: "30代" },
                { min: 40, max: 49, label: "40代" },
                { min: 50, max: 59, label: "50代" },
                { min: 60, max: 69, label: "60代" },
                { min: 70, max: 79, label: "70代" },
                { min: 80, max: null, label: "80歳以上" }
            ];

        return base.flatMap(def => {
            const start = min === null ? def.min : Math.max(def.min, min);
            const endBase = def.max;
            const end = max === null
                ? endBase
                : (endBase === null ? max : Math.min(endBase, max));

            if (end !== null && start > end) return [];
            if (max !== null && start > max) return [];

            const fullStart = start === def.min;
            const fullEnd = (endBase === null && end === null) || end === endBase;
            let label = def.label;

            if (!(fullStart && fullEnd)) {
                if (end === null) label = `${start}歳以上`;
                else if (start === end) label = `${start}歳`;
                else label = `${start}～${end}歳`;
            }

            return [{ ...def, start, end, label, originalLabel: def.label }];
        });
    }

    function filteredAgeBucket(age, mode, definitions, filterActive) {
        if (!filterActive) return ageBucket(age, mode);
        const value = n(age);
        if (value === null) return "";
        const match = (definitions || []).find(def =>
            value >= def.start && (def.end === null || value <= def.end)
        );
        return match?.label || "";
    }

    function isTargetAge(age, minAge, maxAge) {
        const a = n(age);
        if (a === null) return false;

        const min = n(minAge);
        const max = n(maxAge);

        if (min !== null && a < min) return false;
        if (max !== null && a > max) return false;
        return true;
    }

    function targetLabel(minAge, maxAge) {
        const min = n(minAge);
        const max = n(maxAge);

        if (min !== null && max !== null) return `${min}～${max}歳`;
        if (min !== null) return `${min}歳以上`;
        if (max !== null) return `${max}歳以下`;
        return "全年齢";
    }

    function monthSortValue(label, dateObj) {
        const text = s(label);
        const m = text.match(/(\d{2,4})年(\d{1,2})月/);

        if (m) {
            let year = Number(m[1]);
            if (year < 100) year += 2000;
            return year * 100 + Number(m[2]);
        }

        if (dateObj instanceof Date && !Number.isNaN(dateObj.getTime())) {
            return dateObj.getFullYear() * 100 + (dateObj.getMonth() + 1);
        }

        return 999999;
    }

    function yesNoMatchLabel(value) {
        if (
            value === true ||
            value === 1 ||
            value === "1" ||
            value === "TRUE"
        ) {
            return "一致";
        }

        if (
            value === false ||
            value === 0 ||
            value === "0" ||
            value === "FALSE"
        ) {
            return "不一致";
        }

        return "（不明）";
    }

    function buildEnterpriseInfo(dataset) {
        const rows = datasetObjects(dataset);
        const map = {};
        let hasAnyDisplayName = false;

        rows.forEach(row => {
            const id = s(row["企業ID"]);
            const label = s(row["表示名"]);
            if (!id || !label) return;
            map[id] = label;
            hasAnyDisplayName = true;
        });

        return { map, hasAnyDisplayName };
    }


function noteFirstLine(value) {
    const text = s(value);
    if (!text) return "（求人備考なし）";
    const first = s(text.split(/<br\s*\/?>/i)[0]);
    return first || "（求人備考なし）";
}

function splitCodes(value) {
    const text = s(value);
    if (!text) return [];
    return text
        .split("::")
        .map(item => s(item))
        .filter(Boolean);
}

function displayLimit(value, fallback = 50) {
    const text = s(value);

    if (!text) return fallback;
    if (text === "すべて" || text.toLowerCase() === "all") {
        return Infinity;
    }

    const num = Number(text);
    return Number.isFinite(num) && num > 0
        ? Math.floor(num)
        : fallback;
}

function commonMasters() {
    return global.VAA_COMMON_MASTERS || {};
}

function commonMasterMap(key) {
    const map = commonMasters()?.[key];
    return map && typeof map === "object" ? map : {};
}

function resolveCommonCode(map, value) {
    const code = s(value);
    if (!code) return "";
    return s(map[code]) || code;
}

function resolveCommonCodes(map, value) {
    return splitCodes(value).map(code => resolveCommonCode(map, code)).filter(Boolean).join("::");
}

function hydrateJobCommonLabels(job) {
    if (!job || typeof job !== "object") return job;
    const salaryMap = commonMasterMap("salaryTypeMap");
    const featureMap = commonMasterMap("featureCodeMap");
    const indeedMap = commonMasterMap("indeedTagMap");

    job["給与区分"] =
        resolveCommonCode(
            salaryMap,
            job["給与区分コード"]
        );

    job["特徴"] =
        resolveCommonCodes(
            featureMap,
            job["特徴コード"]
        );

    job["Indeed求人タグ"] =
        resolveCommonCodes(
            indeedMap,
            job["Indeed求人タグコード"]
        );
    return job;
}

function buildTagMaster() {
    return {
        ...commonMasterMap(
            "indeedTagMap"
        )
    };
}

function buildImageMap(dataset) {
    const rows = datasetObjects(dataset);
    const map = {};

    rows.forEach(row => {
        const fileName = s(row["画像ファイル名"]);
        const url = s(row["画像URL"]);
        if (fileName && url) map[fileName] = url;
    });

    return map;
}

    function buildViewerContext(viewerResponse) {
        const settings = viewerResponse?.settings || {};
        const startKey = dateKey(parseDate(settings["集計開始日"]));
        const endKey = dateKey(parseDate(settings["集計終了日"]));
        const targetAgeMin = settings["ターゲット年齢下限"];
        const targetAgeMax = settings["ターゲット年齢上限"];
        const targetAgeMaxNumber = n(targetAgeMax);
        const ageMode =
            targetAgeMaxNumber !== null &&
            Math.abs(Math.trunc(targetAgeMaxNumber)) % 10 === 5
                ? "年代（5歳ずらし）"
                : "年代";
        const globalAgeMin = settings["集計対象年齢下限"];
        const globalAgeMax = settings["集計対象年齢上限"];
        const globalAgeFilterActive = n(globalAgeMin) !== null || n(globalAgeMax) !== null;
        const globalAgeFilterLabel = globalAgeFilterActive
            ? targetLabel(globalAgeMin, globalAgeMax)
            : "全年齢";
        const ageBucketDefs = filteredAgeBucketDefinitions(ageMode, globalAgeMin, globalAgeMax);
        const visibleAgeCols = ageBucketDefs.map(def => def.label);
        const basicColumnKey = s(settings["基本表列軸"]) || "age";

        const widths = {
            monthDay: positiveInt(settings["月内応募日幅"], 7),
            hour: positiveInt(settings["応募時間帯幅"], 6),
            text: positiveInt(settings["求人原稿文字数幅"], 300),
            tagCount: positiveInt(settings["Indeed求人タグ数幅"], 5),
            imageCount: positiveInt(settings["求人画像枚数幅"], 1),
            hourlySalary: positiveInt(settings["時給下限幅"], 50),
            dailySalary: positiveInt(settings["日給下限幅"], 1000),
            monthlySalary: positiveInt(settings["月給下限幅"], 50000),
            annualSalary: positiveInt(settings["年収下限幅"], 500000)
        };

        const indeedTagLimit =
            displayLimit(
                settings["Indeedタグ表示件数"],
                50
            );

        const topImageLimit =
            displayLimit(
                settings["TOP画像表示件数"],
                50
            );

        const apps = datasetObjects(
            viewerResponse?.datasets?.applicationData || {}
        );

        const jobs = datasetObjects(
            viewerResponse?.datasets?.jobAnalysisMaster || {}
        ).map(
            hydrateJobCommonLabels
        );

        const keywordMaster = readKeywordMaster(
            viewerResponse?.datasets?.keywordMaster || {}
        );

        const tagMaster = buildTagMaster(
            viewerResponse?.datasets?.indeedTagMaster || {}
        );

        const imageMap = buildImageMap(
            viewerResponse?.datasets?.imageMaster || {}
        );

        const jobMap = new Map();

        jobs.forEach(job => {
            const ref = s(job["求人参照ID"]);
            if (ref) jobMap.set(ref, job);
        });

        const enterpriseInfo = buildEnterpriseInfo(
            viewerResponse?.datasets?.enterpriseMaster || {}
        );

        const timelineRecords = [];
        const filteredTimelineRecords = [];
        const recordsAll = [];
        const recordsMatched = [];

        apps.forEach(app => {
            const appDate = parseDate(app["応募日時"]);
            const age = n(app["年齢"]);

            const globalAgeIncluded = !globalAgeFilterActive ||
                isTargetAge(age, globalAgeMin, globalAgeMax);

            if (appDate && !Number.isNaN(appDate.getTime())) {
                const timelineRecord = { appDate, age };
                timelineRecords.push(timelineRecord);
                if (globalAgeIncluded) filteredTimelineRecords.push(timelineRecord);
            }

            const key = dateKey(appDate);

            if (startKey !== null && (key === null || key < startKey)) return;
            if (endKey !== null && (key === null || key > endKey)) return;
            if (!globalAgeIncluded) return;

            const jobRefId = s(app["求人参照ID"]);
            const matchedFlag = truthy(app["求人データ突合フラグ"]);
            const job =
                matchedFlag && jobRefId
                    ? (jobMap.get(jobRefId) || null)
                    : null;

            const enterpriseId = s(app["企業ID"]);
            let enterpriseLabel = enterpriseId;

            if (enterpriseInfo.hasAnyDisplayName) {
                enterpriseLabel =
                    enterpriseInfo.map[enterpriseId] ||
                    (enterpriseId
                        ? `${enterpriseId}（名称未登録）`
                        : "（企業IDなし）");
            }

            const keywordMatch = matchKeywords(
                job ? job["仕事名"] : "",
                keywordMaster
            );

            const noteFirst =
                job
                    ? noteFirstLine(job["求人備考"])
                    : "";

            const record = {
                app,
                job,
                matched: !!job,
                jobRefId,
                appDate,
                age,
                ageBucket: filteredAgeBucket(
                    age,
                    ageMode,
                    ageBucketDefs,
                    globalAgeFilterActive
                ),
                isTarget: isTargetAge(age, targetAgeMin, targetAgeMax),
                enterpriseId,
                enterpriseLabel,
                kwSingle: keywordMatch.single,
                kwFull: keywordMatch.full,
                noteFirst
            };

            recordsAll.push(record);
            if (record.matched) recordsMatched.push(record);
        });

        const basicAgeFilterActive = false;
        const basicRecordsAll = recordsAll;
        const basicRecordsMatched = recordsMatched;

        return {
            settings,
            ageMode,
            ageCols: visibleAgeCols,
            targetAgeMin,
            targetAgeMax,
            globalAgeMin,
            globalAgeMax,
            globalAgeFilterActive,
            globalAgeFilterLabel,
            basicAgeFilterActive,
            basicAgeFilterLabel: globalAgeFilterLabel,
            widths,
            keywordMaster,
            tagMaster,
            imageMap,
            indeedTagLimit,
            topImageLimit,
            enterpriseInfo,
            timelineRecords,
            filteredTimelineRecords,
            recordsAll,
            recordsMatched,
            basicRecordsAll,
            basicRecordsMatched
        };
    }

    function category(label, sortValue = null) {
        return {
            label: s(label) || "（未設定）",
            sortValue
        };
    }

    function sortCrossGroups(groups, config) {
        if (config.sort === "fixed") {
            const orderMap = new Map(
                (config.order || []).map((label, index) => [label, index])
            );

            groups.sort((a, b) => {
                const ai = orderMap.has(a.label)
                    ? orderMap.get(a.label)
                    : 99999;
                const bi = orderMap.has(b.label)
                    ? orderMap.get(b.label)
                    : 99999;

                if (ai !== bi) return ai - bi;
                return a.label.localeCompare(b.label, "ja");
            });
            return;
        }

        if (config.sort === "numericAsc") {
            groups.sort((a, b) => {
                const av =
                    a.sortValue === null || a.sortValue === undefined
                        ? 999999999999
                        : Number(a.sortValue);
                const bv =
                    b.sortValue === null || b.sortValue === undefined
                        ? 999999999999
                        : Number(b.sortValue);

                if (av !== bv) return av - bv;
                return a.label.localeCompare(b.label, "ja");
            });
            return;
        }

        groups.sort((a, b) => {
            if (a.total !== b.total) return b.total - a.total;
            if (a.target !== b.target) return b.target - a.target;
            return a.label.localeCompare(b.label, "ja");
        });
    }

    function aggregateCross(records, categoryFn, context, config = {}) {
        const ageCols = context.ageCols;
        const groups = new Map();

        records.forEach(record => {
            let cat = categoryFn(record);

            if (cat === null || cat === undefined) {
                cat = category("（未設定）");
            } else if (typeof cat !== "object") {
                cat = category(cat);
            }

            const label = s(cat.label) || "（未設定）";

            if (!groups.has(label)) {
                groups.set(label, {
                    label,
                    sortValue:
                        cat.sortValue !== undefined
                            ? cat.sortValue
                            : null,
                    ageCounts: Object.fromEntries(
                        ageCols.map(age => [age, 0])
                    ),
                    total: 0,
                    target: 0
                });
            }

            const group = groups.get(label);
            group.total += 1;
            group.ageCounts[record.ageBucket] =
                (group.ageCounts[record.ageBucket] || 0) + 1;

            if (record.isTarget) {
                group.target += 1;
            }
        });

        const resultGroups = Array.from(groups.values());
        sortCrossGroups(resultGroups, config);

        const baseTarget = records.reduce(
            (sum, record) => sum + (record.isTarget ? 1 : 0),
            0
        );

        return {
            ageCols,
            groups: resultGroups,
            baseTotal: records.length,
            baseTarget
        };
    }

    function salaryDefinition(id, label, context, salaryType, width) {
        const records = context.recordsMatched.filter(record =>
            s(record.job?.["給与区分"]) === salaryType
        );

        return {
            id,
            label,
            baseLabel: `求人突合済応募（${salaryType}）`,
            records,
            sort: "numericAsc",
            conditionText: `バケット幅: ${numberLabel(width)}円`,
            categoryFn: record => {
                const value = n(record.job?.["給与金額MIN"]);

                if (value === null || value <= 0) {
                    return category("（給与下限なし）", 999999999999);
                }

                const start = Math.floor(value / width) * width;
                const end = start + width - 1;

                return category(
                    `${numberLabel(start)}-${numberLabel(end)}円`,
                    start
                );
            }
        };
    }

    function buildBasicTableDefinitions(context) {
        const all = context.basicRecordsAll || context.recordsAll;
        const matched = context.basicRecordsMatched || context.recordsMatched;
        const w = context.widths;
        const definitions = [];

        definitions.push({
            id: "status",
            label: "対応状況別",
            baseLabel: "全応募",
            records: all,
            sort: "countDesc",
            categoryFn: record =>
                category(record.app["対応状況"] || "（未設定）")
        });

        definitions.push({
            id: "month",
            label: "応募月別",
            baseLabel: "全応募",
            records: all,
            sort: "numericAsc",
            categoryFn: record => {
                const label = s(record.app["応募年月"]) || "（不明）";
                return category(label, monthSortValue(label, record.appDate));
            }
        });

        definitions.push({
            id: "media",
            label: "応募媒体別",
            baseLabel: "全応募",
            records: all,
            sort: "countDesc",
            categoryFn: record =>
                category(record.app["応募媒体"] || "（未設定）")
        });

        if (context.enterpriseInfo.hasAnyDisplayName) {
            definitions.push({
                id: "enterprise",
                label: "企業ID別",
                baseLabel: "全応募",
                records: all,
                sort: "countDesc",
                categoryFn: record =>
                    category(record.enterpriseLabel || "（企業IDなし）")
            });
        }

        definitions.push({
            id: "name-script",
            label: "氏名文字種区分別",
            baseLabel: "全応募",
            records: all,
            sort: "fixed",
            order: ["漢字を含む", "漢字を含まない", "（不明）"],
            categoryFn: record =>
                category(record.app["氏名文字種区分"] || "（不明）")
        });

        definitions.push({
            id: "residence",
            label: "居住都道府県別",
            baseLabel: "全応募",
            records: all,
            sort: "countDesc",
            categoryFn: record =>
                category(record.app["居住都道府県"] || "（不明）")
        });

        definitions.push({
            id: "job-category",
            label: "職種別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "countDesc",
            categoryFn: record =>
                category(record.job?.["職種"] || "（未設定）")
        });

        definitions.push({
            id: "employment",
            label: "雇用形態別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "countDesc",
            categoryFn: record =>
                category(record.job?.["雇用形態"] || "（未設定）")
        });

        definitions.push({
            id: "job-location-name",
            label: "求人勤務地名称別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "countDesc",
            categoryFn: record =>
                category(record.job?.["求人勤務地名称"] || "（未設定）")
        });

        definitions.push({
            id: "job-prefecture",
            label: "勤務地都道府県別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "countDesc",
            categoryFn: record =>
                category(record.job?.["勤務地都道府県"] || "（未設定）")
        });

        definitions.push({
            id: "prefecture-match",
            label: "勤務地・居住都道府県一致別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "fixed",
            order: ["一致", "不一致", "（不明）"],
            categoryFn: record =>
                category(
                    yesNoMatchLabel(
                        record.app["勤務地・居住都道府県一致"]
                    )
                )
        });

        if (context.keywordMaster.length > 0) {
            definitions.push({
                id: "job-keyword",
                label: "仕事名KW別",
                baseLabel: "求人突合済応募",
                records: matched,
                sort: "countDesc",
                categoryFn: record =>
                    category(record.kwSingle || "（該当なし）")
            });

            definitions.push({
                id: "job-full-keyword",
                label: "仕事名フルKW別",
                baseLabel: "求人突合済応募",
                records: matched,
                sort: "countDesc",
                categoryFn: record =>
                    category(record.kwFull || "（該当なし）")
            });
        }

        definitions.push({
            id: "recruit-background",
            label: "募集背景別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "countDesc",
            categoryFn: record =>
                category(record.job?.["募集背景"] || "（未設定）")
        });

        definitions.push({
            id: "month-day",
            label: "月内応募日別",
            baseLabel: "全応募",
            records: all,
            sort: "numericAsc",
            conditionText: `バケット幅: ${w.monthDay}日`,
            categoryFn: record => {
                const value = n(record.app["応募日"]);

                if (value === null) {
                    return category("（不明）", 9999);
                }

                const rangeStart =
                    Math.floor((value - 1) / w.monthDay) *
                    w.monthDay +
                    1;

                const rangeEnd =
                    Math.min(rangeStart + w.monthDay - 1, 31);

                return category(
                    `${rangeStart}-${rangeEnd}日`,
                    rangeStart
                );
            }
        });

        definitions.push({
            id: "weekday",
            label: "応募曜日別",
            baseLabel: "全応募",
            records: all,
            sort: "fixed",
            order: ["月", "火", "水", "木", "金", "土", "日", "（不明）"],
            categoryFn: record =>
                category(record.app["応募曜日"] || "（不明）")
        });

        definitions.push({
            id: "hour",
            label: "応募時間帯別",
            baseLabel: "全応募",
            records: all,
            sort: "numericAsc",
            conditionText: `バケット幅: ${w.hour}時間`,
            categoryFn: record => {
                const value = n(record.app["応募時間帯"]);

                if (value === null) {
                    return category("（不明）", 9999);
                }

                const rangeStart =
                    Math.floor(value / w.hour) *
                    w.hour;

                const rangeEnd =
                    Math.min(rangeStart + w.hour - 1, 23);

                return category(
                    w.hour <= 1
                        ? `${rangeStart}時台`
                        : `${rangeStart}～${rangeEnd}時台`,
                    rangeStart
                );
            }
        });

        definitions.push(
            salaryDefinition(
                "hourly-salary",
                "時給下限別",
                context,
                "時給",
                w.hourlySalary
            )
        );

        definitions.push(
            salaryDefinition(
                "daily-salary",
                "日給下限別",
                context,
                "日給",
                w.dailySalary
            )
        );

        definitions.push(
            salaryDefinition(
                "monthly-salary",
                "月給下限別",
                context,
                "月給",
                w.monthlySalary
            )
        );

        definitions.push(
            salaryDefinition(
                "annual-salary",
                "年収下限別",
                context,
                "年収",
                w.annualSalary
            )
        );

        definitions.push({
            id: "text-length",
            label: "求人原稿文字数別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "numericAsc",
            conditionText: `バケット幅: ${numberLabel(w.text)}文字`,
            categoryFn: record => {
                const value = n(record.job?.["求人原稿文字数"]);

                if (value === null) {
                    return category("（文字数なし）", 999999999);
                }

                const rangeStart =
                    Math.floor(value / w.text) *
                    w.text;

                const rangeEnd =
                    rangeStart + w.text - 1;

                return category(
                    `${numberLabel(rangeStart)}-${numberLabel(rangeEnd)}文字`,
                    rangeStart
                );
            }
        });

        definitions.push({
            id: "main-image",
            label: "メイン画像有無別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "fixed",
            order: ["あり", "なし"],
            categoryFn: record =>
                category(
                    s(record.job?.["メイン画像ファイル名"])
                        ? "あり"
                        : "なし"
                )
        });

        definitions.push({
            id: "image-count",
            label: "求人画像枚数別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "numericAsc",
            conditionText: `バケット幅: ${w.imageCount}枚`,
            categoryFn: record => {
                let value = n(record.job?.["求人画像枚数"]);
                if (value === null) value = 0;

                if (w.imageCount <= 1) {
                    return category(`${value}枚`, value);
                }

                const rangeStart =
                    Math.floor(value / w.imageCount) *
                    w.imageCount;

                const rangeEnd =
                    rangeStart + w.imageCount - 1;

                return category(
                    `${rangeStart}-${rangeEnd}枚`,
                    rangeStart
                );
            }
        });

        definitions.push({
            id: "job-video",
            label: "求人動画有無別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "fixed",
            order: ["あり", "なし"],
            categoryFn: record =>
                category(
                    truthy(record.job?.["求人動画あり"])
                        ? "あり"
                        : "なし"
                )
        });

        definitions.push({
            id: "indeed-tag-count",
            label: "Indeed求人タグ数別",
            baseLabel: "求人突合済応募",
            records: matched,
            sort: "numericAsc",
            conditionText: `バケット幅: ${w.tagCount}個`,
            categoryFn: record => {
                let value = n(record.job?.["Indeed求人タグ数"]);
                if (value === null) value = 0;

                const rangeStart =
                    Math.floor(value / w.tagCount) *
                    w.tagCount;

                const rangeEnd =
                    rangeStart + w.tagCount - 1;

                return category(
                    `${rangeStart}-${rangeEnd}個`,
                    rangeStart
                );
            }
        });

        return definitions;
    }

    function aggregateCrossByColumnAxis(
        records,
        categoryFn,
        context,
        config,
        basicColumnState
    ) {
        const columnLabels = basicColumnState.columnLabels || [];
        const groups = new Map();
        const baseColumnCounts = Object.fromEntries(
            columnLabels.map(label => [label, 0])
        );

        records.forEach(record => {
            let rowCat = categoryFn(record);

            if (rowCat === null || rowCat === undefined) {
                rowCat = category("（未設定）");
            } else if (typeof rowCat !== "object") {
                rowCat = category(rowCat);
            }

            const rowLabel = s(rowCat.label) || "（未設定）";

            if (!groups.has(rowLabel)) {
                groups.set(rowLabel, {
                    label: rowLabel,
                    sortValue:
                        rowCat.sortValue !== undefined
                            ? rowCat.sortValue
                            : null,
                    columnCounts: Object.fromEntries(
                        columnLabels.map(label => [label, 0])
                    ),
                    total: 0,
                    target: 0
                });
            }

            const group = groups.get(rowLabel);
            const columnCat = basicColumnAxisCategory(
                record,
                basicColumnState,
                context
            );
            const columnLabel = s(columnCat?.label) || "（未設定）";

            if (!Object.prototype.hasOwnProperty.call(group.columnCounts, columnLabel)) {
                group.columnCounts[columnLabel] = 0;
            }
            if (!Object.prototype.hasOwnProperty.call(baseColumnCounts, columnLabel)) {
                baseColumnCounts[columnLabel] = 0;
            }

            group.columnCounts[columnLabel] += 1;
            baseColumnCounts[columnLabel] += 1;
            group.total += 1;

            if (record.isTarget) {
                group.target += 1;
            }
        });

        const resultGroups = Array.from(groups.values());
        sortCrossGroups(resultGroups, config || {});

        const baseTarget = records.reduce(
            (sum, record) => sum + (record.isTarget ? 1 : 0),
            0
        );

        return {
            columnAxisKey: basicColumnState.key,
            columnAxisLabel: basicColumnState.label,
            columnLabels,
            groups: resultGroups,
            baseTotal: records.length,
            baseTarget,
            baseColumnCounts
        };
    }

    function baseColumnCountsForRecords(
        records,
        columnLabels,
        basicColumnState,
        context
    ) {
        const counts = Object.fromEntries(
            (columnLabels || []).map(label => [label, 0])
        );

        (records || []).forEach(record => {
            const columnCat = basicColumnAxisCategory(
                record,
                basicColumnState,
                context
            );
            const label = s(columnCat?.label) || "（未設定）";
            counts[label] = (counts[label] || 0) + 1;
        });

        return counts;
    }

    function monthLabelFromDate(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}年${date.getMonth() + 1}月`;
    }

    function monthKeyFromDate(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function sameMonth(dateA, dateB) {
        return !!dateA && !!dateB &&
            dateA.getFullYear() === dateB.getFullYear() &&
            dateA.getMonth() === dateB.getMonth();
    }

    function daysInMonth(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    function inDateRange(date, startDate, endDate) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
    }

    function maxDate(records) {
        return records.reduce(
            (latest, record) =>
                !latest || record.appDate > latest
                    ? record.appDate
                    : latest,
            null
        );
    }

    function buildMonthForecastRow(context, aggregate, columnState) {
        const latestDate = maxDate(context.recordsAll.filter(record => record.appDate));

        if (!latestDate) return null;

        const totalDays = daysInMonth(latestDate);
        const latestDay = latestDate.getDate();

        if (!totalDays || latestDay >= totalDays) {
            return null;
        }

        const selectedStart = parseDate(context.settings?.["集計開始日"]);
        const observedStartDay =
            selectedStart && sameMonth(selectedStart, latestDate)
                ? Math.max(1, selectedStart.getDate())
                : 1;
        const observedDayCount = Math.max(1, latestDay - observedStartDay + 1);
        const scale = totalDays / observedDayCount;
        const latestSortValue = latestDate.getFullYear() * 100 + (latestDate.getMonth() + 1);
        const sourceGroup = (aggregate.groups || []).find(group => Number(group.sortValue) === latestSortValue);

        if (!sourceGroup) {
            return null;
        }

        const countLabels = Array.isArray(aggregate.columnLabels)
            ? aggregate.columnLabels
            : (aggregate.ageCols || []);
        const sourceCounts = Array.isArray(aggregate.columnLabels)
            ? (sourceGroup.columnCounts || {})
            : (sourceGroup.ageCounts || {});
        const forecastCounts = Object.fromEntries(
            countLabels.map(label => [
                label,
                Number(((sourceCounts[label] || 0) * scale).toFixed(1))
            ])
        );

        return {
            label: `（${monthLabelFromDate(latestDate)}着地予測）`,
            total: Number((sourceGroup.total * scale).toFixed(1)),
            target: Number((sourceGroup.target * scale).toFixed(1)),
            counts: forecastCounts,
            observedStartDay,
            latestObservedDay: latestDay,
            observedDayCount,
            daysInMonth: totalDays,
            attachedSortValue: latestSortValue,
            sortValue: latestSortValue + 0.1,
            isForecast: true
        };
    }

    function buildBasicCrossTables(context, basicColumnState = null) {
        const columnState =
            basicColumnState ||
            resolveBasicColumnAxis(
                context,
                context.settings?.["基本表列軸"] || "age"
            );

        return buildBasicTableDefinitions(context)
            .filter(def => def.records.length > 0)
            .map(def => {
                const isDistribution =
                    columnState.key !== "age" &&
                    def.id === columnState.selfTableId;

                let aggregate =
                    columnState.key === "age" || isDistribution
                        ? aggregateCross(
                            def.records,
                            def.categoryFn,
                            context,
                            def
                        )
                        : aggregateCrossByColumnAxis(
                            def.records,
                            def.categoryFn,
                            context,
                            def,
                            columnState
                        );

                if (def.id === "month") {
                    aggregate = {
                        ...aggregate,
                        forecast: buildMonthForecastRow(
                            context,
                            aggregate,
                            columnState
                        )
                    };
                }

                return {
                    ...def,
                    presentation:
                        isDistribution
                            ? "distribution"
                            : "cross",
                    aggregate
                };
            });
    }

    function aggregateSingleValueDetail(records, categoryFn, context, sortConfig, basicColumnState) {
        if (basicColumnState?.key && basicColumnState.key !== "age") {
            return aggregateCrossByColumnAxis(
                records,
                categoryFn,
                context,
                sortConfig,
                basicColumnState
            );
        }

        return aggregateCross(
            records,
            categoryFn,
            context,
            sortConfig
        );
    }

function aggregateNoteDetail(context, basicColumnState) {
    const records = context.basicRecordsMatched || context.recordsMatched;

    const visible = records.some(
        record =>
            record.noteFirst &&
            record.noteFirst !== "（求人備考なし）"
    );

    if (!visible) {
        return {
            visible: false,
            aggregate: null
        };
    }

    return {
        visible: true,
        aggregate: aggregateSingleValueDetail(
            records,
            record =>
                category(
                    record.noteFirst ||
                    "（求人備考なし）"
                ),
            context,
            { sort: "countDesc" },
            basicColumnState
        )
    };
}

function emptyAgeCounts(ageCols) {
    return Object.fromEntries(
        ageCols.map(age => [age, 0])
    );
}

function accumulateMultiGroup(group, record) {
    group.total += 1;
    group.ageCounts[record.ageBucket] =
        (group.ageCounts[record.ageBucket] || 0) + 1;

    if (record.isTarget) group.target += 1;
    if (record.jobRefId) group.jobRefs.add(record.jobRefId);
}

function aggregateIndeedTags(context, basicColumnState) {
    const records = context.basicRecordsMatched || context.recordsMatched;
    const isAgeAxis = !basicColumnState || basicColumnState.key === "age";
    const columnLabels = isAgeAxis
        ? [...context.ageCols]
        : [...(basicColumnState.columnLabels || [])];
    const groups = new Map();
    let realTagExists = false;

    function ensureGroup(code, label, special = "") {
        const key = code || special;

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                code,
                label,
                special,
                ageCounts: isAgeAxis ? emptyAgeCounts(context.ageCols) : null,
                columnCounts: isAgeAxis
                    ? null
                    : Object.fromEntries(columnLabels.map(col => [col, 0])),
                total: 0,
                target: 0,
                jobRefs: new Set()
            });
        }

        return groups.get(key);
    }

    records.forEach(record => {
        const codes = splitCodes(
            record.job?.["Indeed求人タグコード"]
        );

        if (!codes.length) {
            const noTag = ensureGroup(
                "",
                "（タグなし）",
                "__NO_TAG__"
            );

            accumulateMultiDetailGroup(noTag, record, isAgeAxis, columnLabels, basicColumnState, context);
            return;
        }

        realTagExists = true;
        const seen = new Set();

        codes.forEach(code => {
            if (seen.has(code)) return;
            seen.add(code);

            const label =
                context.tagMaster[code] ||
                `${code}（名称未登録）`;

            const group = ensureGroup(code, label, "");
            accumulateMultiDetailGroup(group, record, isAgeAxis, columnLabels, basicColumnState, context);
        });
    });

    if (!realTagExists) {
        return {
            visible: false,
            rows: [],
            baseTotal: records.length,
            baseTarget: 0
        };
    }

    let noTagGroup = null;
    let realGroups = [];

    groups.forEach(group => {
        if (group.special === "__NO_TAG__") {
            noTagGroup = group;
        } else {
            realGroups.push(group);
        }
    });

    realGroups.sort((a, b) => {
        if (!isAgeAxis && basicColumnState?.key === "month") {
            if (a.total !== b.total) return b.total - a.total;
        } else if (a.target !== b.target) {
            return b.target - a.target;
        }
        if (a.total !== b.total) return b.total - a.total;
        return a.label.localeCompare(b.label, "ja");
    });

    if (Number.isFinite(context.indeedTagLimit)) {
        realGroups = realGroups.slice(0, context.indeedTagLimit);
    }

    if (noTagGroup) realGroups.push(noTagGroup);

    const baseTotal = records.length;
    const baseTarget = records.reduce(
        (sum, record) => sum + (record.isTarget ? 1 : 0),
        0
    );

    const baseColumnCounts = isAgeAxis
        ? undefined
        : baseColumnCountsForRecords(
            records,
            columnLabels,
            basicColumnState,
            context
        );

    return {
        visible: true,
        ageCols: isAgeAxis ? context.ageCols : undefined,
        columnLabels: isAgeAxis ? undefined : columnLabels,
        columnAxisKey: isAgeAxis ? "age" : basicColumnState.key,
        columnAxisLabel: isAgeAxis ? "年齢" : basicColumnState.label,
        baseTotal,
        baseTarget,
        baseColumnCounts,
        displayLimit: context.indeedTagLimit,
        rows: realGroups.map(group => ({
            label: group.label,
            ageCounts: group.ageCounts || undefined,
            columnCounts: group.columnCounts || undefined,
            total: group.total,
            coverRate: baseTotal ? group.total / baseTotal : 0,
            target: group.target,
            targetRate: group.total ? group.target / group.total : 0,
            targetCoverRate: baseTarget ? group.target / baseTarget : 0,
            jobCount: group.jobRefs.size,
            appsPerJob:
                group.jobRefs.size
                    ? group.total / group.jobRefs.size
                    : 0
        }))
    };
}

function accumulateMultiDetailGroup(group, record, isAgeAxis, columnLabels, basicColumnState, context) {
    group.total += 1;

    if (isAgeAxis) {
        group.ageCounts[record.ageBucket] =
            (group.ageCounts[record.ageBucket] || 0) + 1;
    } else {
        const columnCat = basicColumnAxisCategory(
            record,
            basicColumnState,
            context
        );
        const columnLabel = s(columnCat?.label) || "（未設定）";

        if (!Object.prototype.hasOwnProperty.call(group.columnCounts, columnLabel)) {
            group.columnCounts[columnLabel] = 0;
        }

        group.columnCounts[columnLabel] += 1;
    }

    if (record.isTarget) group.target += 1;
    if (record.jobRefId) group.jobRefs.add(record.jobRefId);
}

function aggregateTopImages(context, basicColumnState) {
    const records = context.basicRecordsMatched || context.recordsMatched;
    const isAgeAxis = !basicColumnState || basicColumnState.key === "age";
    const columnLabels = isAgeAxis
        ? [...context.ageCols]
        : [...(basicColumnState.columnLabels || [])];
    const groups = new Map();
    let hasAnyImage = false;

    records.forEach(record => {
        const fileName = s(
            record.job?.["メイン画像ファイル名"]
        );

        if (fileName) hasAnyImage = true;

        const key = fileName || "__NO_IMAGE__";

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: fileName || "（TOP画像なし）",
                fileName,
                noImage: !fileName,
                ageCounts: isAgeAxis ? emptyAgeCounts(context.ageCols) : null,
                columnCounts: isAgeAxis
                    ? null
                    : Object.fromEntries(columnLabels.map(col => [col, 0])),
                total: 0,
                target: 0,
                jobRefs: new Set()
            });
        }

        const group = groups.get(key);
        group.total += 1;

        if (isAgeAxis) {
            group.ageCounts[record.ageBucket] =
                (group.ageCounts[record.ageBucket] || 0) + 1;
        } else {
            const columnCat = basicColumnAxisCategory(
                record,
                basicColumnState,
                context
            );
            const columnLabel = s(columnCat?.label) || "（未設定）";

            if (!Object.prototype.hasOwnProperty.call(group.columnCounts, columnLabel)) {
                group.columnCounts[columnLabel] = 0;
            }

            group.columnCounts[columnLabel] += 1;
        }

        if (record.isTarget) group.target += 1;
        if (record.jobRefId) group.jobRefs.add(record.jobRefId);
    });

    if (!hasAnyImage) {
        return {
            visible: false,
            rows: [],
            baseTotal: records.length,
            baseTarget: 0
        };
    }

    let noImageGroup = null;
    let realGroups = [];

    groups.forEach(group => {
        if (group.noImage) {
            noImageGroup = group;
        } else {
            realGroups.push(group);
        }
    });

    realGroups.sort((a, b) => {
        if (!isAgeAxis && basicColumnState?.key === "month") {
            if (a.total !== b.total) return b.total - a.total;
        } else if (a.target !== b.target) {
            return b.target - a.target;
        }
        if (a.total !== b.total) return b.total - a.total;
        return a.label.localeCompare(b.label, "ja");
    });

    if (Number.isFinite(context.topImageLimit)) {
        realGroups = realGroups.slice(0, context.topImageLimit);
    }

    if (noImageGroup) realGroups.push(noImageGroup);

    const baseTotal = records.length;
    const baseTarget = records.reduce(
        (sum, record) => sum + (record.isTarget ? 1 : 0),
        0
    );

    const baseColumnCounts = isAgeAxis
        ? undefined
        : baseColumnCountsForRecords(
            records,
            columnLabels,
            basicColumnState,
            context
        );

    return {
        visible: true,
        ageCols: isAgeAxis ? context.ageCols : undefined,
        columnLabels: isAgeAxis ? undefined : columnLabels,
        columnAxisKey: isAgeAxis ? "age" : basicColumnState.key,
        columnAxisLabel: isAgeAxis ? "年齢" : basicColumnState.label,
        baseTotal,
        baseTarget,
        baseColumnCounts,
        displayLimit: context.topImageLimit,
        rows: realGroups.map(group => ({
            label: group.label,
            fileName: group.fileName,
            imageUrl:
                group.fileName
                    ? (context.imageMap[group.fileName] || "")
                    : "",
            ageCounts: group.ageCounts || undefined,
            columnCounts: group.columnCounts || undefined,
            total: group.total,
            share: baseTotal ? group.total / baseTotal : 0,
            target: group.target,
            targetRate: group.total ? group.target / group.total : 0,
            targetShare: baseTarget ? group.target / baseTarget : 0,
            jobCount: group.jobRefs.size,
            appsPerJob:
                group.jobRefs.size
                    ? group.total / group.jobRefs.size
                    : 0
        }))
    };
}

function buildMonthProgress(context) {
    const displayMode = s(context.settings?.["応募進捗表示モード"]) || "cumulative";
    const ageFilterLabel = context.globalAgeFilterLabel || "全年齢";
    const selectedStartDate = parseDate(context.settings?.["集計開始日"]);
    const selectedEndDate = parseDate(context.settings?.["集計終了日"]);
    const allTimeline = context.timelineRecords || [];
    const filteredTimeline = context.filteredTimelineRecords || allTimeline;
    const dataStartDate = allTimeline.reduce(
        (earliest, record) => !earliest || record.appDate < earliest ? record.appDate : earliest,
        null
    );
    const dataEndDate = maxDate(allTimeline);
    const startDate = selectedStartDate || dataStartDate;
    const endDate = selectedEndDate || dataEndDate;
    const observedPeriodRecords = allTimeline.filter(record =>
        inDateRange(record.appDate, startDate, endDate)
    );
    const periodRecords = filteredTimeline.filter(record =>
        inDateRange(record.appDate, startDate, endDate)
    );

    if (!observedPeriodRecords.length) {
        return {
            visible: false,
            ageFilterLabel,
            displayMode
        };
    }

    const latestDate = maxDate(observedPeriodRecords);
    const latestMonthKey = monthKeyFromDate(latestDate);
    const latestMonthLabel = monthLabelFromDate(latestDate);
    const totalDays = daysInMonth(latestDate);
    const latestObservedDay = latestDate.getDate();
    const observedStartDay =
        startDate && sameMonth(startDate, latestDate)
            ? Math.max(1, startDate.getDate())
            : 1;
    const observedDayCount = Math.max(1, latestObservedDay - observedStartDay + 1);

    function emptyDaily() {
        return Array.from({ length: 31 }, () => null);
    }

    function cumulativeFromDaily(daily) {
        let sum = 0;
        return daily.map(value => {
            if (value === null || value === undefined) return null;
            sum += Number(value || 0);
            return sum;
        });
    }

    function monthOverlapsSelectedPeriod(date) {
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        if (startDate && monthEnd < startDate) return false;
        if (endDate && monthStart > endDate) return false;
        return true;
    }

    function sameMonthSeries(date) {
        const key = monthKeyFromDate(date);
        const monthDayCount = daysInMonth(date);
        const daily = emptyDaily();
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        const effectiveStart = startDate && startDate > monthStart ? startDate : monthStart;
        const effectiveEnd = endDate && endDate < monthEnd ? endDate : monthEnd;
        const firstAllowedDay = Math.max(1, effectiveStart.getDate());
        const lastAllowedDay = Math.min(monthDayCount, effectiveEnd.getDate());

        for (let day = firstAllowedDay; day <= lastAllowedDay; day += 1) {
            daily[day - 1] = 0;
        }

        filteredTimeline.forEach(record => {
            if (!sameMonth(record.appDate, date)) return;
            if (!inDateRange(record.appDate, startDate, endDate)) return;
            const day = record.appDate.getDate();
            daily[day - 1] = (daily[day - 1] || 0) + 1;
        });

        const cumulative = cumulativeFromDaily(daily);
        const finalValue = cumulative[lastAllowedDay - 1];
        const sameDayIndex = Math.min(latestObservedDay, monthDayCount) - 1;
        const sameDayValue = cumulative[sameDayIndex];

        return {
            key,
            label: monthLabelFromDate(date),
            monthDayCount,
            daily,
            cumulative,
            total: finalValue === null || finalValue === undefined ? null : finalValue,
            sameDayTotal: sameDayValue === null || sameDayValue === undefined ? null : sameDayValue,
            firstAllowedDay,
            lastAllowedDay
        };
    }

    const currentDaily = emptyDaily();
    for (let day = observedStartDay; day <= latestObservedDay; day += 1) {
        currentDaily[day - 1] = 0;
    }

    periodRecords.forEach(record => {
        if (!sameMonth(record.appDate, latestDate)) return;
        const day = record.appDate.getDate();
        if (day < observedStartDay || day > latestObservedDay) return;
        currentDaily[day - 1] = (currentDaily[day - 1] || 0) + 1;
    });

    const currentCumulative = cumulativeFromDaily(currentDaily);
    const currentTotal = currentCumulative[latestObservedDay - 1] || 0;
    const projectedTotal =
        latestObservedDay < totalDays
            ? Number((currentTotal / observedDayCount * totalDays).toFixed(1))
            : null;
    const projectedCumulative = [...currentCumulative];

    if (projectedTotal !== null && totalDays > latestObservedDay) {
        const remainingDays = totalDays - latestObservedDay;
        for (let day = latestObservedDay + 1; day <= totalDays; day += 1) {
            const progress = (day - latestObservedDay) / remainingDays;
            projectedCumulative[day - 1] = Number((currentTotal + (projectedTotal - currentTotal) * progress).toFixed(1));
        }
    }

    const comparisonSeeds = [
        {
            date: new Date(latestDate.getFullYear(), latestDate.getMonth() - 1, 1),
            kind: "prev1"
        },
        {
            date: new Date(latestDate.getFullYear(), latestDate.getMonth() - 2, 1),
            kind: "prev2"
        },
        {
            date: new Date(latestDate.getFullYear() - 1, latestDate.getMonth(), 1),
            kind: "lastYearSameMonth"
        }
    ];
    const seenKeys = new Set();
    const comparisons = comparisonSeeds
        .filter(seed => monthOverlapsSelectedPeriod(seed.date))
        .map(seed => ({
            ...sameMonthSeries(seed.date),
            kind: seed.kind
        }))
        .filter(series => {
            if (!series.key || seenKeys.has(series.key)) return false;
            seenKeys.add(series.key);
            return true;
        });

    const summary = {
        currentActual: currentTotal,
        latestObservedDay,
        latestDataDate: latestDate,
        projectedTotal,
        previousMonthSameDay: comparisons.find(series => series.kind === "prev1")?.sameDayTotal ?? null,
        previousMonthLabel: comparisons.find(series => series.kind === "prev1")?.label || "",
        lastYearSameDay: comparisons.find(series => series.kind === "lastYearSameMonth")?.sameDayTotal ?? null,
        lastYearLabel: comparisons.find(series => series.kind === "lastYearSameMonth")?.label || ""
    };

    return {
        visible: true,
        ageFilterLabel,
        displayMode,
        latestMonthKey,
        latestMonthLabel,
        latestDate,
        latestObservedDay,
        observedStartDay,
        observedDayCount,
        daysInMonth: totalDays,
        current: {
            label: latestMonthLabel,
            daily: currentDaily,
            cumulative: currentCumulative,
            projectedCumulative,
            actualTotal: currentTotal,
            projectedTotal
        },
        comparisons,
        summary
    };
}

function viewerDisplaySettingsMap(displaySettings) {
    const map = {};

    (
        Array.isArray(displaySettings)
            ? displaySettings
            : []
    ).forEach(item => {
        const id = s(item?.id);
        if (!id) return;

        map[id] =
            item?.visible !== false;
    });

    return map;
}

function viewerDisplaySettingEnabled(map, id) {
    return !Object.prototype
        .hasOwnProperty.call(
            map,
            id
        ) ||
        map[id] !== false;
}

function customAxisOptions(
    context,
    displaySettings
) {
    const visibility =
        viewerDisplaySettingsMap(
            displaySettings
        );

    const rules = [
        ["対応状況", "status"],
        ["応募年月", "month"],
        ["応募媒体", "media"],
        ["氏名文字種区分", "name-script"],
        ["居住都道府県", "residence"],
        ["企業ID", "enterprise"],
        ["職種", "job-category"],
        ["雇用形態", "employment"],
        ["求人勤務地名称", "job-location-name"],
        ["勤務地都道府県", "job-prefecture"],
        ["勤務地・居住都道府県一致", "prefecture-match"],
        ["募集背景", "recruit-background"],
        ["月内応募日", "month-day"],
        ["応募曜日", "weekday"],
        ["応募時間帯", "hour"],
        ["時給下限", "hourly-salary"],
        ["日給下限", "daily-salary"],
        ["月給下限", "monthly-salary"],
        ["年収下限", "annual-salary"],
        ["求人原稿文字数", "text-length"],
        ["メイン画像有無", "main-image"],
        ["求人画像枚数", "image-count"],
        ["TOP画像ファイル名", "top-image-detail"],
        ["求人動画有無", "job-video"],
        ["Indeed求人タグ数", "indeed-tag-count"],
        ["求人備考1行目", "note-detail"]
    ];

    const options =
        rules
            .filter(
                ([, settingId]) =>
                    viewerDisplaySettingEnabled(
                        visibility,
                        settingId
                    )
            )
            .map(
                ([axis]) =>
                    axis
            );

    const salaryVisible =
        [
            "hourly-salary",
            "daily-salary",
            "monthly-salary",
            "annual-salary"
        ].some(
            id =>
                viewerDisplaySettingEnabled(
                    visibility,
                    id
                )
        );

    if (salaryVisible) {
        const firstSalaryIndex =
            [
                "時給下限",
                "日給下限",
                "月給下限",
                "年収下限"
            ]
                .map(axis =>
                    options.indexOf(axis)
                )
                .filter(index => index >= 0)
                .sort((a, b) => a - b)[0];

        if (
            firstSalaryIndex !==
            undefined
        ) {
            options.splice(
                firstSalaryIndex,
                0,
                "給与区分"
            );
        }
    }

    if (
        context.keywordMaster.length > 0
    ) {
        const keywordAxes = [];

        if (
            viewerDisplaySettingEnabled(
                visibility,
                "job-keyword"
            )
        ) {
            keywordAxes.push(
                "仕事名KW"
            );
        }

        if (
            viewerDisplaySettingEnabled(
                visibility,
                "job-full-keyword"
            )
        ) {
            keywordAxes.push(
                "仕事名フルKW"
            );
        }

        if (keywordAxes.length) {
            const recruitIndex =
                options.indexOf(
                    "募集背景"
                );

            options.splice(
                recruitIndex >= 0
                    ? recruitIndex
                    : options.length,
                0,
                ...keywordAxes
            );
        }
    }

    return options;
}


function customAxisRequiresJob(axis) {
    const appOnly = new Set([
        "対応状況",
        "応募年月",
        "応募媒体",
        "氏名文字種区分",
        "居住都道府県",
        "企業ID",
        "月内応募日",
        "応募曜日",
        "応募時間帯"
    ]);

    return !appOnly.has(axis);
}

function fixedSortValue(label, order) {
    const index = order.indexOf(label);
    return index >= 0 ? index : 99999;
}

function customSalaryValue(record, salaryType, width) {
    if (s(record.job?.["給与区分"]) !== salaryType) {
        return null;
    }

    const value = n(record.job?.["給与金額MIN"]);

    if (value === null || value <= 0) {
        return category("（給与下限なし）", 999999999999);
    }

    const start = Math.floor(value / width) * width;
    const end = start + width - 1;

    return category(
        `${numberLabel(start)}-${numberLabel(end)}円`,
        start
    );
}

function customAxisValue(record, axis, context) {
    const w = context.widths;

    if (axis === "対応状況") {
        return category(record.app["対応状況"] || "（未設定）");
    }

    if (axis === "応募年月") {
        const label = s(record.app["応募年月"]) || "（不明）";
        return category(
            label,
            monthSortValue(label, record.appDate)
        );
    }

    if (axis === "応募媒体") {
        return category(record.app["応募媒体"] || "（未設定）");
    }

    if (axis === "氏名文字種区分") {
        const label = record.app["氏名文字種区分"] || "（不明）";
        return category(
            label,
            fixedSortValue(
                label,
                ["漢字を含む", "漢字を含まない", "（不明）"]
            )
        );
    }

    if (axis === "居住都道府県") {
        return category(record.app["居住都道府県"] || "（不明）");
    }

    if (axis === "企業ID") {
        return category(
            record.enterpriseLabel ||
            record.enterpriseId ||
            "（企業IDなし）"
        );
    }

    if (axis === "月内応募日") {
        const value = n(record.app["応募日"]);

        if (value === null) return category("（不明）", 9999);

        const start =
            Math.floor((value - 1) / w.monthDay) *
            w.monthDay +
            1;

        const end = Math.min(start + w.monthDay - 1, 31);

        return category(`${start}-${end}日`, start);
    }

    if (axis === "応募曜日") {
        const label = record.app["応募曜日"] || "（不明）";

        return category(
            label,
            fixedSortValue(
                label,
                ["月", "火", "水", "木", "金", "土", "日", "（不明）"]
            )
        );
    }

    if (axis === "応募時間帯") {
        const value = n(record.app["応募時間帯"]);

        if (value === null) return category("（不明）", 9999);

        const start = Math.floor(value / w.hour) * w.hour;
        const end = Math.min(start + w.hour - 1, 23);

        return category(
            w.hour <= 1
                ? `${start}時台`
                : `${start}～${end}時台`,
            start
        );
    }

    if (!record.matched) return null;

    if (axis === "職種") {
        return category(record.job?.["職種"] || "（未設定）");
    }

    if (axis === "雇用形態") {
        return category(record.job?.["雇用形態"] || "（未設定）");
    }

    if (axis === "求人勤務地名称") {
        return category(record.job?.["求人勤務地名称"] || "（未設定）");
    }

    if (axis === "勤務地都道府県") {
        return category(record.job?.["勤務地都道府県"] || "（未設定）");
    }

    if (axis === "勤務地・居住都道府県一致") {
        const label = yesNoMatchLabel(
            record.app["勤務地・居住都道府県一致"]
        );

        return category(
            label,
            fixedSortValue(
                label,
                ["一致", "不一致", "（不明）"]
            )
        );
    }

    if (axis === "仕事名KW") {
        return category(record.kwSingle || "（該当なし）");
    }

    if (axis === "仕事名フルKW") {
        return category(record.kwFull || "（該当なし）");
    }

    if (axis === "募集背景") {
        return category(record.job?.["募集背景"] || "（未設定）");
    }

    if (axis === "給与区分") {
        return category(record.job?.["給与区分"] || "（未設定）");
    }

    if (axis === "時給下限") {
        return customSalaryValue(record, "時給", w.hourlySalary);
    }

    if (axis === "日給下限") {
        return customSalaryValue(record, "日給", w.dailySalary);
    }

    if (axis === "月給下限") {
        return customSalaryValue(record, "月給", w.monthlySalary);
    }

    if (axis === "年収下限") {
        return customSalaryValue(record, "年収", w.annualSalary);
    }

    if (axis === "求人原稿文字数") {
        const value = n(record.job?.["求人原稿文字数"]);

        if (value === null) {
            return category("（文字数なし）", 999999999);
        }

        const start = Math.floor(value / w.text) * w.text;
        const end = start + w.text - 1;

        return category(
            `${numberLabel(start)}-${numberLabel(end)}文字`,
            start
        );
    }

    if (axis === "メイン画像有無") {
        const label =
            s(record.job?.["メイン画像ファイル名"])
                ? "あり"
                : "なし";

        return category(
            label,
            fixedSortValue(label, ["あり", "なし"])
        );
    }

    if (axis === "求人画像枚数") {
        let value = n(record.job?.["求人画像枚数"]);
        if (value === null) value = 0;

        if (w.imageCount <= 1) {
            return category(`${value}枚`, value);
        }

        const start =
            Math.floor(value / w.imageCount) *
            w.imageCount;

        const end =
            start +
            w.imageCount -
            1;

        return category(
            `${start}～${end}枚`,
            start
        );
    }

    if (axis === "TOP画像ファイル名") {
        return category(
            s(record.job?.["メイン画像ファイル名"]) ||
            "（TOP画像なし）"
        );
    }

    if (axis === "求人動画有無") {
        const label =
            truthy(record.job?.["求人動画あり"])
                ? "あり"
                : "なし";

        return category(
            label,
            fixedSortValue(label, ["あり", "なし"])
        );
    }

    if (axis === "Indeed求人タグ数") {
        let value = n(record.job?.["Indeed求人タグ数"]);
        if (value === null) value = 0;

        const start =
            Math.floor(value / w.tagCount) *
            w.tagCount;

        const end = start + w.tagCount - 1;

        return category(`${start}-${end}個`, start);
    }

    if (axis === "求人備考1行目") {
        return category(
            record.noteFirst || "（求人備考なし）"
        );
    }

    return null;
}

const BASIC_COLUMN_AXIS_DEFINITIONS = Object.freeze([
    {
        key: "age",
        label: "年代",
        axis: "",
        selfTableId: "age",
        maxColumns: 99
    },
    {
        key: "month",
        label: "応募年月",
        axis: "応募年月",
        selfTableId: "month",
        // v30.39: 横スクロール前提で長期比較を行えるよう、基本表の応募年月列を最大36列へ拡張。
        maxColumns: 36
    },
    {
        key: "media",
        label: "応募媒体",
        axis: "応募媒体",
        selfTableId: "media",
        maxColumns: 12
    },
    {
        key: "job-category",
        label: "職種",
        axis: "職種",
        selfTableId: "job-category",
        maxColumns: 12,
        requiresMatched: true
    },
    {
        key: "employment",
        label: "雇用形態",
        axis: "雇用形態",
        selfTableId: "employment",
        maxColumns: 12,
        requiresMatched: true
    },
    {
        key: "weekday",
        label: "応募曜日",
        axis: "応募曜日",
        selfTableId: "weekday",
        maxColumns: 8,
        completeLabels: ["月", "火", "水", "木", "金", "土", "日"]
    }
]);

function basicColumnAxisCategory(record, definition, context) {
    if (definition.key === "age") {
        const label = record.ageBucket || "（不明）";
        return category(
            label,
            fixedSortValue(label, context.ageCols)
        );
    }

    if (
        definition.requiresMatched &&
        !record.matched
    ) {
        return category(
            "（求人未突合）",
            999999999998
        );
    }

    return (
        customAxisValue(
            record,
            definition.axis,
            context
        ) ||
        category("（未設定）")
    );
}

function collectBasicColumnLabels(context, definition) {
    if (definition.key === "age") {
        return [...context.ageCols];
    }

    const labels = [];
    const metaMap = new Map();
    const totalMap = new Map();

    context.recordsAll.forEach(record => {
        const cat = basicColumnAxisCategory(
            record,
            definition,
            context
        );
        const label = s(cat?.label) || "（未設定）";

        if (!metaMap.has(label)) {
            labels.push(label);
            metaMap.set(label, cat || {});
        }

        totalMap.set(
            label,
            (totalMap.get(label) || 0) + 1
        );
    });

    if (Array.isArray(definition.completeLabels)) {
        const extras = labels.filter(
            label => !definition.completeLabels.includes(label)
        );

        sortCustomLabels(extras, metaMap, totalMap);

        return [
            ...definition.completeLabels,
            ...extras
        ];
    }

    const unmatchedIndex = labels.indexOf("（求人未突合）");
    const unmatchedLabel =
        unmatchedIndex >= 0
            ? labels.splice(unmatchedIndex, 1)[0]
            : "";

    sortCustomLabels(labels, metaMap, totalMap);

    if (unmatchedLabel) {
        labels.push(unmatchedLabel);
    }

    return labels;
}

function basicColumnAxisOptions(context) {
    return BASIC_COLUMN_AXIS_DEFINITIONS.map(definition => {
        const columnLabels = collectBasicColumnLabels(
            context,
            definition
        );
        const categoryCount = columnLabels.length;
        const hasRequiredData =
            !definition.requiresMatched ||
            context.recordsMatched.length > 0;
        const available =
            definition.key === "age" ||
            (
                hasRequiredData &&
                categoryCount > 0 &&
                categoryCount <= definition.maxColumns
            );

        let unavailableReason = "";

        if (!available) {
            if (!hasRequiredData) {
                unavailableReason = "求人突合済応募がありません";
            } else if (categoryCount > definition.maxColumns) {
                unavailableReason = `${categoryCount}種類あるため基本表では利用できません`;
            } else {
                unavailableReason = "利用できるデータがありません";
            }
        }

        return {
            ...definition,
            columnLabels,
            categoryCount,
            available,
            unavailableReason
        };
    });
}

function resolveBasicColumnAxis(context, requestedKey) {
    const options = basicColumnAxisOptions(context);
    const requested =
        options.find(option => option.key === requestedKey) ||
        options[0];
    const selected =
        requested?.available
            ? requested
            : options.find(option => option.key === "age") || options[0];

    return {
        ...selected,
        options
    };
}

function sortCustomLabels(labels, metaMap, totalMap) {
    labels.sort((a, b) => {
        const am = metaMap.get(a) || {};
        const bm = metaMap.get(b) || {};

        const av = am.sortValue;
        const bv = bm.sortValue;

        const aHas =
            av !== null &&
            av !== undefined &&
            Number.isFinite(Number(av));

        const bHas =
            bv !== null &&
            bv !== undefined &&
            Number.isFinite(Number(bv));

        if (aHas && bHas && Number(av) !== Number(bv)) {
            return Number(av) - Number(bv);
        }

        if (aHas !== bHas) return aHas ? -1 : 1;

        const at = totalMap.get(a) || 0;
        const bt = totalMap.get(b) || 0;

        if (at !== bt) return bt - at;
        return a.localeCompare(b, "ja");
    });
}

function compareCustomCategory(
    a,
    b
) {
    const av =
        a?.sortValue;

    const bv =
        b?.sortValue;

    const aHas =
        av !== null &&
        av !== undefined &&
        Number.isFinite(
            Number(av)
        );

    const bHas =
        bv !== null &&
        bv !== undefined &&
        Number.isFinite(
            Number(bv)
        );

    if (
        aHas &&
        bHas &&
        Number(av) !==
            Number(bv)
    ) {
        return (
            Number(av) -
            Number(bv)
        );
    }

    if (
        aHas !== bHas
    ) {
        return aHas
            ? -1
            : 1;
    }

    return String(
        a?.label || ""
    ).localeCompare(
        String(
            b?.label || ""
        ),
        "ja",
        {
            numeric: true,
            sensitivity:
                "base"
        }
    );
}

function aggregateCustom(context, options = {}) {
    const rowAxes =
        (
            Array.isArray(
                options.rowAxes
            )
                ? options.rowAxes
                : [
                    options.rowAxis
                ]
        )
            .map(s)
            .filter(Boolean)
            .slice(0, 3);

    const colAxis =
        s(options.colAxis);

    const ageFilterMode =
        s(options.ageFilterMode) === "指定範囲"
            ? "指定範囲"
            : "全年齢";

    const ageMin =
        n(options.ageMin);

    const ageMax =
        n(options.ageMax);

    if (
        !rowAxes.length ||
        !colAxis
    ) {
        return {
            ok: false,
            reason:
                "AXIS_REQUIRED"
        };
    }

    const allAxes = [
        ...rowAxes,
        colAxis
    ];

    if (
        new Set(allAxes)
            .size !==
        allAxes.length
    ) {
        return {
            ok: false,
            reason:
                "DUPLICATE_AXIS"
        };
    }

    const requiresJob =
        allAxes.some(
            customAxisRequiresJob
        );

    let base =
        requiresJob
            ? context.recordsMatched
            : context.recordsAll;

    if (
        ageFilterMode ===
        "指定範囲"
    ) {
        base =
            base.filter(
                record => {
                    if (
                        record.age ===
                        null
                    ) {
                        return false;
                    }

                    if (
                        ageMin !== null &&
                        record.age <
                            ageMin
                    ) {
                        return false;
                    }

                    if (
                        ageMax !== null &&
                        record.age >
                            ageMax
                    ) {
                        return false;
                    }

                    return true;
                }
            );
    }

    const rowMeta =
        new Map();

    const colMeta =
        new Map();

    const matrix =
        new Map();

    const rowTotals =
        new Map();

    const colTotals =
        new Map();

    let usedRecords =
        0;

    base.forEach(
        record => {
            const rowCats =
                rowAxes.map(
                    axis =>
                        customAxisValue(
                            record,
                            axis,
                            context
                        )
                );

            const colCat =
                customAxisValue(
                    record,
                    colAxis,
                    context
                );

            if (
                rowCats.some(
                    item => !item
                ) ||
                !colCat
            ) {
                return;
            }

            const rowLabels =
                rowCats.map(
                    item =>
                        item.label
                );

            const rowKey =
                JSON.stringify(
                    rowLabels
                );

            const cLabel =
                colCat.label;

            if (
                !rowMeta.has(
                    rowKey
                )
            ) {
                rowMeta.set(
                    rowKey,
                    {
                        key:
                            rowKey,
                        labels:
                            rowLabels,
                        categories:
                            rowCats
                    }
                );
            }

            if (
                !colMeta.has(
                    cLabel
                )
            ) {
                colMeta.set(
                    cLabel,
                    colCat
                );
            }

            if (
                !matrix.has(
                    rowKey
                )
            ) {
                matrix.set(
                    rowKey,
                    new Map()
                );
            }

            const rowMap =
                matrix.get(
                    rowKey
                );

            rowMap.set(
                cLabel,
                (
                    rowMap.get(
                        cLabel
                    ) ||
                    0
                ) + 1
            );

            rowTotals.set(
                rowKey,
                (
                    rowTotals.get(
                        rowKey
                    ) ||
                    0
                ) + 1
            );

            colTotals.set(
                cLabel,
                (
                    colTotals.get(
                        cLabel
                    ) ||
                    0
                ) + 1
            );

            usedRecords += 1;
        }
    );

    const rowEntries =
        Array.from(
            rowMeta.values()
        );

    rowEntries.sort(
        (a, b) => {
            for (
                let i = 0;
                i <
                Math.max(
                    a.categories.length,
                    b.categories.length
                );
                i++
            ) {
                const result =
                    compareCustomCategory(
                        a.categories[i],
                        b.categories[i]
                    );

                if (result) {
                    return result;
                }
            }

            return (
                (
                    rowTotals.get(
                        b.key
                    ) ||
                    0
                ) -
                (
                    rowTotals.get(
                        a.key
                    ) ||
                    0
                )
            );
        }
    );

    const colLabels =
        Array.from(
            colMeta.keys()
        );

    sortCustomLabels(
        colLabels,
        colMeta,
        colTotals
    );

    if (
        colLabels.length >
        100
    ) {
        return {
            ok: false,
            reason:
                "TOO_MANY_COLUMNS",
            columnCount:
                colLabels.length
        };
    }

    if (!usedRecords) {
        return {
            ok: false,
            reason:
                "NO_DATA"
        };
    }

    return {
        ok: true,
        rowAxes,
        rowAxis:
            rowAxes[0],
        colAxis,
        ageFilterMode,
        ageMin,
        ageMax,
        rowEntries,
        colLabels,
        matrix,
        rowTotals,
        colTotals,
        applicationCount:
            usedRecords
    };
}

    function aggregateViewer(viewerResponse) {
        const context = buildViewerContext(viewerResponse);
        const records = context.recordsAll;

        const targetCount = records.reduce(
            (sum, record) => sum + (record.isTarget ? 1 : 0),
            0
        );

        const ageCountMap = Object.fromEntries(
            context.ageCols.map(label => [label, 0])
        );

        records.forEach(record => {
            ageCountMap[record.ageBucket] =
                (ageCountMap[record.ageBucket] || 0) + 1;
        });

        const ageRows = context.ageCols.map(label => ({
            label,
            count: ageCountMap[label] || 0,
            share: records.length
                ? (ageCountMap[label] || 0) / records.length
                : 0
        }));

        const basicColumnAxis = resolveBasicColumnAxis(
            context,
            context.settings?.["基本表列軸"] || "age"
        );

        return {
            context,
            settings: context.settings,
            basicColumnAxis,
            totalCount: records.length,
            targetCount,
            targetRate: records.length
                ? targetCount / records.length
                : 0,
            matchedCount: context.recordsMatched.length,
            matchedRate: records.length
                ? context.recordsMatched.length / records.length
                : 0,
            targetLabel: targetLabel(
                context.targetAgeMin,
                context.targetAgeMax
            ),
            ageMode: context.ageMode,
            ageRows,
            monthProgress: buildMonthProgress(context),
            basicCrossTables: buildBasicCrossTables(
                context,
                basicColumnAxis
            ),
            noteDetail: aggregateNoteDetail(context, basicColumnAxis),
            indeedTagDetail: aggregateIndeedTags(context, basicColumnAxis),
            topImageDetail: aggregateTopImages(context, basicColumnAxis),
            customAxisOptions:
                customAxisOptions(
                    context,
                    viewerResponse?.displaySettings || []
                )
        };
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString("ja-JP");
    }

    function formatPercent(value, digits = 1) {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        return `${(num * 100).toFixed(digits)}%`;
    }

    global.ValidApplicationAnalysisCore = {
        s,
        n,
        truthy,
        datasetObjects,
        parseDate,
        dateKey,
        ageBuckets,
        ageBucket,
        isTargetAge,
        targetLabel,
        readKeywordMaster,
        matchKeywords,
        buildViewerContext,
        aggregateCross,
        aggregateCrossByColumnAxis,
        basicColumnAxisOptions,
        resolveBasicColumnAxis,
        buildBasicCrossTables,
        aggregateNoteDetail,
        aggregateIndeedTags,
        aggregateTopImages,
        viewerDisplaySettingsMap,
        viewerDisplaySettingEnabled,
        customAxisOptions,
        customAxisRequiresJob,
        customAxisValue,
        aggregateCustom,
        aggregateViewer,
        aggregateViewerMvp: aggregateViewer,
        formatNumber,
        formatPercent
    };
})(window);
