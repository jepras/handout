import json
import sqlite3
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

BASE = Path(__file__).parent
DB_PATH = BASE / "app.db"
SEED_MEMBERS = BASE / "seed_members.json"
SEED_CASES = BASE / "seed_cases.json"
SEED_PROJECTIONS = BASE / "seed_projections.json"


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS members (
                member_id TEXT PRIMARY KEY,
                age INTEGER,
                profession_group TEXT,
                region TEXT,
                annual_salary REAL,
                membership_status TEXT,
                pension_scheme TEXT,
                employer_id TEXT,
                joined_date TEXT,
                retirement_target_age INTEGER
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cases (
                case_id TEXT PRIMARY KEY,
                member_id TEXT,
                case_type TEXT,
                status TEXT,
                priority TEXT,
                created_at TEXT,
                closed_at TEXT,
                sla_hours INTEGER,
                breached_sla INTEGER,
                outcome TEXT,
                complexity_score INTEGER
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cases_member ON cases(member_id)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projections (
                member_id TEXT PRIMARY KEY,
                retirement_age INTEGER,
                expected_monthly_pension REAL,
                expected_lump_sum REAL,
                scenario TEXT
            )
            """
        )

        if conn.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 0 and SEED_MEMBERS.exists():
            members = json.loads(SEED_MEMBERS.read_text())
            conn.executemany(
                """
                INSERT INTO members (member_id, age, profession_group, region, annual_salary,
                                     membership_status, pension_scheme, employer_id,
                                     joined_date, retirement_target_age)
                VALUES (:member_id, :age, :profession_group, :region, :annual_salary,
                        :membership_status, :pension_scheme, :employer_id,
                        :joined_date, :retirement_target_age)
                """,
                members,
            )

        if conn.execute("SELECT COUNT(*) FROM projections").fetchone()[0] == 0 and SEED_PROJECTIONS.exists():
            projections = json.loads(SEED_PROJECTIONS.read_text())
            conn.executemany(
                """
                INSERT INTO projections (member_id, retirement_age, expected_monthly_pension,
                                         expected_lump_sum, scenario)
                VALUES (:member_id, :retirement_age, :expected_monthly_pension,
                        :expected_lump_sum, :scenario)
                """,
                projections,
            )

        if conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 0 and SEED_CASES.exists():
            cases = json.loads(SEED_CASES.read_text())
            conn.executemany(
                """
                INSERT INTO cases (case_id, member_id, case_type, status, priority,
                                   created_at, closed_at, sla_hours, breached_sla,
                                   outcome, complexity_score)
                VALUES (:case_id, :member_id, :case_type, :status, :priority,
                        :created_at, :closed_at, :sla_hours, :breached_sla,
                        :outcome, :complexity_score)
                """,
                cases,
            )


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5180",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def row_to_dict(cursor, row) -> dict:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@app.get("/api/members")
def list_members() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT member_id AS id, age, profession_group, region, annual_salary
            FROM members
            ORDER BY member_id
            """
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/members/{member_id}")
def get_member(member_id: str) -> dict:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        member = conn.execute(
            "SELECT * FROM members WHERE member_id = ?", (member_id,)
        ).fetchone()
        if member is None:
            raise HTTPException(status_code=404, detail="Medlem ikke fundet")
        cases = conn.execute(
            """
            SELECT * FROM cases
            WHERE member_id = ? AND status != 'closed'
            ORDER BY created_at DESC
            """,
            (member_id,),
        ).fetchall()
        projection = conn.execute(
            "SELECT * FROM projections WHERE member_id = ?", (member_id,)
        ).fetchone()
    return {
        "member": dict(member),
        "active_cases": [dict(c) for c in cases],
        "projection": dict(projection) if projection else None,
    }


DST_URL = "https://api.statbank.dk/v1/data/PENFOR11/JSONSTAT"
DST_YEAR = "2024"
_dst_cache: dict[str, float] = {}


def age_to_pension_bracket(age: int) -> str:
    if age < 25:
        return "18-24"
    if age >= 90:
        return "9000"
    low = (age // 5) * 5
    return f"{low}-{low + 4}"


def fetch_dst_pension_by_age() -> dict[str, float]:
    if _dst_cache:
        return _dst_cache
    qs = urllib.parse.urlencode(
        {
            "PENSIONSFORM": "31",
            "BESKAT": "30",
            "ALDER": "*",
            "KOEN": "MOK",
            "ENHED": "GNS",
            "Tid": DST_YEAR,
            "lang": "en",
        }
    )
    with urllib.request.urlopen(f"{DST_URL}?{qs}", timeout=10) as resp:
        data = json.loads(resp.read())
    ds = data["dataset"]
    ids = list(ds["dimension"]["ALDER"]["category"]["index"].keys())
    values = ds["value"]
    _dst_cache.update(dict(zip(ids, values)))
    return _dst_cache


@app.get("/api/benchmark/pension")
def benchmark_pension(age: int) -> dict:
    try:
        bracketed = fetch_dst_pension_by_age()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DST utilgængelig: {exc}")
    bracket = age_to_pension_bracket(age)
    avg = bracketed.get(bracket)
    if avg is None:
        raise HTTPException(status_code=404, detail=f"Ingen DST-data for alder {age}")
    return {
        "age": age,
        "age_bracket": bracket,
        "national_avg_pension_wealth": avg,
        "source": "Danmarks Statistik (PENFOR11)",
        "year": DST_YEAR,
        "unit": "DKK",
        "note": "Gennemsnitlig samlet pensionsformue pr. person i aldersgruppen (alle pensionsformer)",
    }


@app.get("/api/cases")
def list_cases(member_id: str | None = None) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if member_id:
            rows = conn.execute(
                "SELECT * FROM cases WHERE member_id = ? ORDER BY created_at DESC",
                (member_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM cases ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
    return [dict(r) for r in rows]
