import { readAnnualRevenueState, type AnnualRevenueState } from "./annual-revenue.ts";
import { readDepartmentHeadcountGrowthState, type DepartmentHeadcountGrowthState } from "./department-headcount-growth.ts";
import { readDepartmentHeadcountState, type DepartmentHeadcountState } from "./department-headcount.ts";
import { waitForAccountFilterFieldset } from "./dom.ts";
import { readHeadcountGrowthState, type HeadcountGrowthState } from "./headcount-growth.ts";
import { readHeadcountState, type AccountHeadcountState } from "./headcount.ts";
import { readHeadquartersLocationState, type HeadquartersLocationState } from "./headquarters-location.ts";
import { readIndustryState, type IndustryState } from "./industry.ts";
import { readKeywords } from "./keywords.ts";
import { readPagination } from "./results.ts";


export interface AccountSearchState {
  headcount: AccountHeadcountState,
  annualRevenue: AnnualRevenueState,
  headcountGrowth: HeadcountGrowthState,
  departmentHeadcount: DepartmentHeadcountState,
  departmentHeadcountGrowth: DepartmentHeadcountGrowthState,
  headquartersLocation: HeadquartersLocationState,
  industry: IndustryState,
  keywords: string,
  page: number | null,
  totalPages: number | null,
}

export async function getSearchState(): Promise<AccountSearchState> {
  await Promise.all([
    waitForAccountFilterFieldset("COMPANY_HEADCOUNT", "Company headcount"),
    waitForAccountFilterFieldset("ANNUAL_REVENUE", "Annual revenue"),
    waitForAccountFilterFieldset(
      "COMPANY_HEADCOUNT_GROWTH",
      "Company headcount growth",
    ),
    waitForAccountFilterFieldset(
      "HEADQUARTERS_LOCATION",
      "Headquarters location",
    ),
    waitForAccountFilterFieldset("INDUSTRY", "Industry"),
  ]);

  let keywords = "";
  try {
    keywords = readKeywords();
  } catch {
    // Keyword input can be absent during a partial render; empty is honest.
  }

  return {
    headcount: readHeadcountState(),
    annualRevenue: await readAnnualRevenueState(),
    headcountGrowth: readHeadcountGrowthState(),
    departmentHeadcount: await readDepartmentHeadcountState(),
    departmentHeadcountGrowth: await readDepartmentHeadcountGrowthState(),
    headquartersLocation: readHeadquartersLocationState(),
    industry: readIndustryState(),
    keywords,
    ...readPagination(),
  }
}
