"""PostgreSQL-backed API integration tests.

Set NEXUS_TEST_DATABASE_URL to a dedicated PostgreSQL test database URL to run.
The test creates and removes a uniquely named schema and never uses SQLite.
"""

import os
import unittest
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db import models  # noqa: F401 - register model metadata
POSTGRES_TEST_URL = os.getenv("NEXUS_TEST_DATABASE_URL")


@unittest.skipUnless(POSTGRES_TEST_URL, "NEXUS_TEST_DATABASE_URL is not configured")
class PostgreSQLFinancialTwinApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        from app.core.database import get_db
        from app.main import app

        if not POSTGRES_TEST_URL.startswith(("postgresql+psycopg://", "postgresql://")):
            raise RuntimeError("NEXUS_TEST_DATABASE_URL must be a PostgreSQL URL")
        cls.schema = f"nexus_test_{uuid4().hex}"
        cls.engine = create_engine(POSTGRES_TEST_URL)
        cls.connection = cls.engine.connect()
        cls.connection.execute(text(f'CREATE SCHEMA "{cls.schema}"'))
        cls.connection.execute(text(f'SET search_path TO "{cls.schema}"'))
        cls.connection.commit()
        Base.metadata.create_all(cls.connection)
        cls.connection.commit()
        cls.Session = sessionmaker(
            bind=cls.connection, autoflush=False, expire_on_commit=False
        )
        cls.app = app

        def test_db():
            with cls.Session() as session:
                yield session

        cls.dependency = test_db
        cls.app.dependency_overrides[get_db] = test_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.app.dependency_overrides.pop(get_db, None)
        cls.connection.execute(text("SET search_path TO public"))
        cls.connection.execute(text(f'DROP SCHEMA "{cls.schema}" CASCADE'))
        cls.connection.commit()
        cls.connection.close()
        cls.engine.dispose()

    def test_persisted_api_data_reconstructs_financial_twin(self):
        client = self.client
        user_response = client.post(
            "/api/users", json={"displayName": "NEXUS demo", "email": f"{uuid4()}@example.test"}
        )
        self.assertEqual(user_response.status_code, 201, user_response.text)
        user_id = user_response.json()["id"]

        profile_response = client.post(
            "/api/financial-profiles", json={"userId": user_id, "currency": "INR"}
        )
        self.assertEqual(profile_response.status_code, 201, profile_response.text)
        profile_id = profile_response.json()["id"]

        for item in (
            {"name": "Salary", "amount": "20000", "frequency": "monthly"},
            {"name": "Consulting", "amount": "10000", "frequency": "monthly"},
        ):
            response = client.post(f"/api/financial-profiles/{profile_id}/income", json=item)
            self.assertEqual(response.status_code, 201, response.text)

        for item in (
            {"category": "housing", "name": "Rent", "amount": "15000", "essential": True},
            {"category": "food", "name": "Groceries", "amount": "5000", "essential": False},
        ):
            response = client.post(f"/api/financial-profiles/{profile_id}/expenses", json=item)
            self.assertEqual(response.status_code, 201, response.text)

        debt = client.post(
            f"/api/financial-profiles/{profile_id}/debts",
            json={"name": "Loan", "principalAmount": "0", "paymentAmount": "0"},
        )
        self.assertEqual(debt.status_code, 201, debt.text)
        asset = client.post(
            f"/api/financial-profiles/{profile_id}/assets",
            json={"name": "Savings", "assetType": "cash", "currentValue": "40000", "liquid": True},
        )
        self.assertEqual(asset.status_code, 201, asset.text)
        investment = client.post(
            f"/api/financial-profiles/{profile_id}/investments",
            json={"name": "Index fund", "investmentType": "fund", "currentValue": "90000"},
        )
        self.assertEqual(investment.status_code, 201, investment.text)
        goal = client.post(
            f"/api/financial-profiles/{profile_id}/goals",
            json={
                "name": "Education", "targetAmount": "200000",
                "currentAllocatedAmount": "40000", "targetDate": "2027-10-02",
                "currentContribution": "5000", "priority": 1,
            },
        )
        self.assertEqual(goal.status_code, 201, goal.text)
        another_goal = client.post(
            f"/api/financial-profiles/{profile_id}/goals",
            json={
                "name": "Emergency fund", "targetAmount": "100000",
                "currentAllocatedAmount": "25000", "priority": 2,
            },
        )
        self.assertEqual(another_goal.status_code, 201, another_goal.text)

        response = client.get(f"/api/financial-profiles/{profile_id}/financial-twin")
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(len(result["income_sources"]), 2)
        self.assertEqual(len(result["expenses"]), 2)
        self.assertEqual([item["essential"] for item in result["expenses"]], [True, False])
        self.assertEqual(len(result["goals"]), 2)
        self.assertNotEqual(result["goals"][0]["id"], result["goals"][1]["id"])
        self.assertEqual(result["financialTwin"]["liquidSavings"], "40000")
        self.assertEqual(result["financialTwin"]["investments"], "90000")
        metrics = result["derivedMetrics"]
        self.assertEqual(metrics["monthlySurplus"], "10000")
        self.assertEqual(metrics["savingsRate"], "0.3333333333333333333333333333")
        self.assertEqual(metrics["debtToIncome"], "0")
        self.assertEqual(
            metrics["emergencyCoverageMonths"],
            "2.666666666666666666666666667",
        )
        self.assertEqual(metrics["goalFundingGap"], "235000")

        rejected = client.post(
            f"/api/financial-profiles/{profile_id}/income",
            json={"name": "Invalid", "amount": "-1"},
        )
        self.assertEqual(rejected.status_code, 422)


if __name__ == "__main__":
    unittest.main()
