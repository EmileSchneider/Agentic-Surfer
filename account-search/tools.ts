import { ToolError } from "../types.ts";
import {
  clearAnnualRevenue,
  listAnnualRevenueOptions,
  setAnnualRevenue,
} from "./annual-revenue.ts";
import {
  clearHeadcount,
  listHeadcountOptions,
  selectHeadcountOption,
} from "./headcount.ts";
import {
  clearHeadcountGrowth,
  setHeadcountGrowth,
} from "./headcount-growth.ts";
import {
  clearDepartmentHeadcount,
  listDepartmentHeadcountDepartments,
  readDepartmentHeadcountState,
  setDepartmentHeadcount,
} from "./department-headcount.ts";
import {
  clearDepartmentHeadcountGrowth,
  listDepartmentHeadcountGrowthDepartments,
  readDepartmentHeadcountGrowthState,
  setDepartmentHeadcountGrowth,
} from "./department-headcount-growth.ts";
import {
  clearHeadquartersLocation,
  searchHeadquartersLocationOptions,
  selectHeadquartersLocationOption,
} from "./headquarters-location.ts";
import {
  clearIndustry,
  searchIndustryOptions,
  selectIndustryOption,
} from "./industry.ts";
import { clearKeywords, setKeywords } from "./keywords.ts";
import {
  goToAccountPage,
  goToNextAccountPage,
  goToPreviousAccountPage,
  readAccountPagination,
  readAccountResults,
} from "./results.ts";
import { waitFor } from "../linkedin/dom.ts";
import { getSearchState } from "./search_state.ts";

async function setKeywordSearch(text: string) {
  await setKeywords(text);
  return await getSearchState();
}

async function clearKeywordSearch() {
  await clearKeywords();
  return await getSearchState();
}

async function nextPage() {
  await goToNextAccountPage();
  return await getSearchState();
}

const ACCOUNT_SEARCH_FORM_SELECTOR =
  'form[data-x-search-filter-panel="form"][data-sn-view-name="account-search-filters"]';

async function waitForAccountSearchForm(): Promise<void> {
  await waitFor(
    () => {
      const form = document.querySelector(ACCOUNT_SEARCH_FORM_SELECTOR);
      return form?.querySelector("fieldset[data-x-search-filter]") !== null;
    },
    15_000,
    "account search filter form"
  );
}

export async function runAccountSearchTool(msg: {
  command: string;
  args: any;
}): Promise<unknown> {
  await waitForAccountSearchForm();
  
  switch (msg.command) {
    case "accountSearch.getState":
      return await getSearchState();
    case "accountSearch.readResults":
    case "readResults":
      return await readAccountResults(msg.args?.limit);
    case "accountSearch.getPagination":
      return readAccountPagination();
    case "accountSearch.nextPage":
      return await nextPage();
    case "accountSearch.previousPage":
      return await goToPreviousAccountPage();
    case "accountSearch.goToPage":
      return await goToAccountPage(Number(msg.args?.page));
    case "accountSearch.listAnnualRevenueOptions":
      return await listAnnualRevenueOptions();
    case "accountSearch.setAnnualRevenue":
      return await setAnnualRevenue(msg.args ?? {});
    case "accountSearch.clearAnnualRevenue":
      return await clearAnnualRevenue();
    case "accountSearch.listHeadcountOptions":
      return await listHeadcountOptions();
    case "accountSearch.selectHeadcountOption":
      return await selectHeadcountOption(msg.args ?? {});
    case "accountSearch.clearHeadcount":
      return await clearHeadcount();
    case "accountSearch.setHeadcountGrowth":
      return await setHeadcountGrowth(msg.args ?? {});
    case "accountSearch.clearHeadcountGrowth":
      return await clearHeadcountGrowth();
    case "accountSearch.listDepartmentHeadcountDepartments":
      return await listDepartmentHeadcountDepartments();
    case "accountSearch.setDepartmentHeadcount":
      return await setDepartmentHeadcount(msg.args ?? {});
    case "accountSearch.clearDepartmentHeadcount":
      return await clearDepartmentHeadcount();
    case "accountSearch.readDepartmentHeadcountState":
      return await readDepartmentHeadcountState();
    case "accountSearch.listDepartmentHeadcountGrowthDepartments":
      return await listDepartmentHeadcountGrowthDepartments();
    case "accountSearch.setDepartmentHeadcountGrowth":
      return await setDepartmentHeadcountGrowth(msg.args ?? {});
    case "accountSearch.clearDepartmentHeadcountGrowth":
      return await clearDepartmentHeadcountGrowth();
    case "accountSearch.readDepartmentHeadcountGrowthState":
      return await readDepartmentHeadcountGrowthState();
    case "accountSearch.searchHeadquartersLocationOptions":
      return await searchHeadquartersLocationOptions(String(msg.args?.query ?? ""));
    case "accountSearch.selectHeadquartersLocationOption":
      return await selectHeadquartersLocationOption(msg.args ?? {});
    case "accountSearch.clearHeadquartersLocation":
      return await clearHeadquartersLocation();
    case "accountSearch.searchIndustryOptions":
      return await searchIndustryOptions(String(msg.args?.query ?? ""));
    case "accountSearch.selectIndustryOption":
      return await selectIndustryOption(msg.args ?? {});
    case "accountSearch.clearIndustry":
      return await clearIndustry();
    case "accountSearch.setKeywords":
      return await setKeywordSearch(String(msg.args?.text ?? ""));
    case "accountSearch.clearKeywords":
      return await clearKeywordSearch();
    default:
      throw new ToolError(
        "BAD_ARGS",
        `Unknown account search tool: ${msg.command}`,
      );
  }
}
