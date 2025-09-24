/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// FIX: Added GenerateContentResponse to imports for proper typing of Gemini API responses.
import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// --- TYPE DEFINITIONS ---
type IncomeSource = { id: number; description: string; amount: number; isRecurring?: boolean; recurringId?: number };
type Expense = { id: number; description: string; amount: number; category: string; isRecurring?: boolean; recurringId?: number };
type RealExpense = { id: number; description: string; amount: number; date: string; linkedCategory: string; };
type Category = { name: string; color: string; };
type TransactionType = 'expense' | 'income';
type EditingTransaction = (Expense & { type: 'expense' }) | (IncomeSource & { type: 'income' }) | null;
type EditingRecurringTransaction = (Expense & { type: 'expense' }) | (IncomeSource & { type: 'income' }) | null;

type MonthlyData = { realIncome: IncomeSource[], plannedExpenses: Expense[], realExpenses: RealExpense[] };

// --- STATE MANAGEMENT ---
let isInitialized = false;

// Global data that doesn't change per month
let globalState = {
    categories: [] as Category[],
    recurringIncomes: [] as IncomeSource[],
    recurringExpenses: [] as Expense[],
};

// UI and session state
let uiState = {
    activeTab: 'budget' as 'budget' | 'tracking' | 'stats' | 'flow',
    selectedMonth: getMonthKey(new Date()),
    isSuggesting: false,
    isTransactionModalOpen: false,
    isRecurringModalOpen: false,
    isCategoryModalOpen: false,
    editingTransaction: null as EditingTransaction,
    editingRecurringTransaction: null as EditingRecurringTransaction,
    editingRealExpense: null as RealExpense | null,
    transactionModalType: 'expense' as TransactionType,
    recurringModalType: 'expense' as TransactionType,
    expandedCategory: null as string | null,
};

let monthlyData: { [key: string]: MonthlyData } = {};


// --- LOCAL STORAGE & STATE INITIALIZATION ---
const saveDataToLocalStorage = () => {
    localStorage.setItem('monthlyData', JSON.stringify(monthlyData));
    localStorage.setItem('recurringIncomes', JSON.stringify(globalState.recurringIncomes));
    localStorage.setItem('recurringExpenses', JSON.stringify(globalState.recurringExpenses));
    localStorage.setItem('categories', JSON.stringify(globalState.categories));
};

const sortCategories = () => {
    globalState.categories.sort((a, b) => a.name.localeCompare(b.name));
};

function getMonthKey(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${year}-${month}`;
}

const createMonthDataFromRecurring = (): MonthlyData => ({
    realIncome: globalState.recurringIncomes.map(i => ({
        ...i,
        id: Date.now() + Math.random(), // Unique instance ID
        isRecurring: true,
        recurringId: i.id, // Link to template
    })),
    plannedExpenses: globalState.recurringExpenses.map(e => ({
        ...e,
        id: Date.now() + Math.random(),
        isRecurring: true,
        recurringId: e.id,
    })),
    realExpenses: [],
});


// FIX: Converted from an arrow function to a function declaration. This might help with parser issues related to generics in TSX files, addressing the "Cannot find name 'T'" error.
function loadFromStorage<T>(key: string): T | null {
    const savedData = localStorage.getItem(key);
    if (!savedData) return null;
    try {
        return JSON.parse(savedData) as T;
    } catch (error) {
        console.error(`Error parsing ${key} from localStorage, data will be reset:`, error);
        localStorage.removeItem(key); // Remove corrupted data to prevent future errors
        return null;
    }
}

function initializeState() {
    if (isInitialized) return;

    // Load global data safely
    globalState.recurringIncomes = loadFromStorage<IncomeSource[]>('recurringIncomes') || [];
    globalState.recurringExpenses = loadFromStorage<Expense[]>('recurringExpenses') || [];
    globalState.categories = loadFromStorage<Category[]>('categories') || [
            { name: 'Animaux', color: '#10b981' }, { name: 'Assurance', color: '#06b6d4' },
            { name: 'Cadeaux et association caritative', color: '#8b5cf6' }, { name: 'Enfants', color: '#d946ef' },
            { name: 'Épargne ou investissements', color: '#f97316' }, { name: 'Logement', color: '#ef4444' },
            { name: 'Loisirs', color: '#ec4899' }, { name: 'Prêts', color: '#84cc16' }, { name: 'Repas', color: '#eab308' },
            { name: 'Soins personnels', color: '#6366f1' }, { name: 'Taxes', color: '#78716c' }, { name: 'Transport', color: '#64748b' },
        ];
    
    sortCategories();

    // Load monthly data safely
    monthlyData = loadFromStorage<{ [key: string]: MonthlyData }>('monthlyData') || {};
    
    // Data migration for old structure
    Object.keys(monthlyData).forEach(key => {
        const month = monthlyData[key] as any;
        if (month.expenses && !month.plannedExpenses) {
            month.plannedExpenses = month.expenses;
            delete month.expenses;
        }
        if (!month.realExpenses) {
            month.realExpenses = [];
        }
    });

    // Ensure current month exists, if not, create it from recurring items
    if (!monthlyData[uiState.selectedMonth]) {
        monthlyData[uiState.selectedMonth] = createMonthDataFromRecurring();
    }
    
    isInitialized = true;
}

// --- DATA ACCESSORS FOR CURRENT MONTH ---
const getCurrentIncomes = (): IncomeSource[] => monthlyData[uiState.selectedMonth]?.realIncome || [];
const getCurrentPlannedExpenses = (): Expense[] => monthlyData[uiState.selectedMonth]?.plannedExpenses || [];
const getCurrentRealExpenses = (): RealExpense[] => monthlyData[uiState.selectedMonth]?.realExpenses || [];

// --- CALCULATIONS ---
const totalRealIncome = () => getCurrentIncomes().reduce((sum, item) => sum + item.amount, 0);
const totalPlannedExpenses = () => getCurrentPlannedExpenses().reduce((sum, item) => sum + item.amount, 0);
const totalActualSpent = () => getCurrentRealExpenses().reduce((sum, item) => sum + item.amount, 0);
const formatCurrency = (value: number) => value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const getCategoryColor = (categoryName: string) => globalState.categories.find(c => c.name === categoryName)?.color || '#94a3b8';
const formatMonthForDisplay = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
};

// --- UI UPDATE FUNCTIONS (GRANULAR) ---
function updateAll() {
    updateMonthNavigator();
    updateBalanceOverview();
    updateIncomeDetails();
    updateBudgetDetailTable();
    updateCharts();
}

function renderApp() {
    const appContainer = document.getElementById('root');
    if (!appContainer) return;
    
    if (!appContainer.innerHTML) {
        appContainer.innerHTML = AppShell();
        attachGlobalEventListeners();
    }
    
    updateTabs();
    updateTabContent();
    updateAll();
}

function AppShell() {
    return `
        <div class="container mx-auto p-4 md:p-8 text-slate-700">
            <div id="modal-container"></div>
            ${Tabs()}
            <div id="tab-content" class="mt-6"></div>
        </div>
    `;
}

function updateTabs() {
    const tabsContainer = document.getElementById('tabs-container');
    if (tabsContainer) tabsContainer.innerHTML = Tabs();
}

function updateTabContent() {
    const tabContent = document.getElementById('tab-content');
    if (!tabContent) return;

    let activeTabView = '';
    if (uiState.activeTab === 'budget') activeTabView = BudgetView();
    else if (uiState.activeTab === 'tracking') activeTabView = RealTrackingView();
    else if (uiState.activeTab === 'stats') activeTabView = StatsView();
    else if (uiState.activeTab === 'flow') activeTabView = FlowView();
    
    if (tabContent.innerHTML !== activeTabView) {
        tabContent.innerHTML = `<div class="animate-fade-in">${activeTabView}</div>`;
    }
    
    if (uiState.activeTab === 'budget' || uiState.activeTab === 'tracking') updateAll();
    else updateCharts();
}

function updateModals() {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;
    
    let modalHTML = '';
    if (uiState.isTransactionModalOpen) modalHTML = TransactionModal();
    if (uiState.isRecurringModalOpen) modalHTML = RecurringModal();
    if (uiState.isCategoryModalOpen) modalHTML = CategoryManagerModal();
    
    modalContainer.innerHTML = modalHTML;
}

function updateRecurringModalLists() {
    const incomeListEl = document.getElementById('recurring-incomes-list');
    if (incomeListEl) {
        incomeListEl.innerHTML = renderRecurringList(globalState.recurringIncomes, 'income');
    }
    const expenseListEl = document.getElementById('recurring-expenses-list');
    if (expenseListEl) {
        expenseListEl.innerHTML = renderRecurringList(globalState.recurringExpenses, 'expense');
    }
}


function updateMonthNavigator() {
    const el = document.getElementById('month-navigator-container');
    if (el) el.innerHTML = MonthNavigator();
}

function updateBalanceOverview() {
    const el = document.getElementById('balance-overview-container');
    if (el) el.innerHTML = BalanceOverview();
}

function updateIncomeDetails() {
    const el = document.getElementById('income-details-container');
    if (el) el.innerHTML = IncomeDetails();
}

function updateBudgetDetailTable() {
    const el = document.getElementById('budget-detail-table-container');
    if (el) el.innerHTML = BudgetDetailTable();
}

function updateRealExpensesList() {
    const el = document.getElementById('real-expenses-list-container');
    if(el) el.innerHTML = RealExpensesList();
}


function updateCharts() {
    if(uiState.activeTab === 'stats' || uiState.activeTab === 'flow') {
        setTimeout(renderCharts, 0);
    }
}

function Tabs() {
    return `
        <div id="tabs-container" class="border-b border-slate-200">
            <button data-tab="budget" class="tab-btn py-3 px-4 text-base font-medium ${uiState.activeTab === 'budget' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500 hover:text-slate-700'}">Planification</button>
            <button data-tab="tracking" class="tab-btn py-3 px-4 text-base font-medium ${uiState.activeTab === 'tracking' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500 hover:text-slate-700'}">Suivi Réel</button>
            <button data-tab="stats" class="tab-btn py-3 px-4 text-base font-medium ${uiState.activeTab === 'stats' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500 hover:text-slate-700'}">Statistiques</button>
            <button data-tab="flow" class="tab-btn py-3 px-4 text-base font-medium ${uiState.activeTab === 'flow' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-500 hover:text-slate-700'}">Analyse des flux</button>
        </div>
    `;
}

function MonthNavigator() {
    return `<div class="flex items-center justify-center gap-4 mb-6">
        <button data-action="prev-month" class="p-2 rounded-full hover:bg-slate-200"><i class="fas fa-chevron-left"></i></button>
        <h2 class="text-2xl font-bold text-slate-800 text-center w-52">${formatMonthForDisplay(uiState.selectedMonth)}</h2>
        <button data-action="next-month" class="p-2 rounded-full hover:bg-slate-200"><i class="fas fa-chevron-right"></i></button>
    </div>`;
}

function BudgetView() {
    return `
        <div id="month-navigator-container">${MonthNavigator()}</div>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-8">
            <div class="md:col-span-2 space-y-6">
                <div id="balance-overview-container">${BalanceOverview()}</div>
                <div id="income-details-container">${IncomeDetails()}</div>
            </div>
            <div class="md:col-span-3 space-y-6">
                <div class="flex justify-between items-center flex-wrap gap-2">
                    ${Header('Détail de la Planification')}
                    <div class="flex gap-2 flex-wrap">
                        <button data-action="open-transaction-modal" class="action-btn bg-sky-600 text-white px-4 py-2 rounded-lg hover:bg-sky-700 text-sm font-semibold">Ajouter une Transaction</button>
                        <button data-action="open-recurring-modal" class="action-btn bg-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-300 text-sm font-semibold">Gérer les récurrents</button>
                        <button data-action="open-category-modal" class="action-btn bg-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-300 text-sm font-semibold">Gérer les catégories</button>
                    </div>
                </div>
                <div id="budget-detail-table-container">${BudgetDetailTable()}</div>
            </div>
        </div>
    `;
}

function RealTrackingView() {
    const plannedCategoriesWithExpenses = globalState.categories.filter(cat => 
        getCurrentPlannedExpenses().some(exp => exp.category === cat.name)
    );
    const isEditing = uiState.editingRealExpense !== null;
    return `
        <div id="month-navigator-container">${MonthNavigator()}</div>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-8">
            <div class="md:col-span-2 space-y-6">
                ${Header(isEditing ? 'Modifier la Dépense Réelle' : 'Ajouter une Dépense Réelle')}
                <div class="bg-white p-6 rounded-xl shadow-md">
                    <form id="add-real-expense-form" class="space-y-4">
                        <div>
                            <label for="real-expense-description" class="block text-sm font-medium text-slate-600 mb-1">Description</label>
                            <input type="text" id="real-expense-description" required class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500" placeholder="Ex: Courses au Super U" value="${uiState.editingRealExpense?.description || ''}">
                        </div>
                        <div>
                            <label for="real-expense-amount" class="block text-sm font-medium text-slate-600 mb-1">Montant (€)</label>
                            <input type="number" id="real-expense-amount" required step="0.01" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500" placeholder="Ex: 52.30" value="${uiState.editingRealExpense?.amount || ''}">
                        </div>
                        <div>
                            <label for="real-expense-date" class="block text-sm font-medium text-slate-600 mb-1">Date</label>
                            <input type="date" id="real-expense-date" required class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500" value="${uiState.editingRealExpense?.date || new Date().toISOString().split('T')[0]}">
                        </div>
                        <div>
                             <label for="real-expense-category" class="block text-sm font-medium text-slate-600 mb-1">Déduire du budget de</label>
                            <select id="real-expense-category" required class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500">
                                <option value="">-- Choisir une catégorie --</option>
                                ${plannedCategoriesWithExpenses.map(c => `<option value="${c.name}" ${uiState.editingRealExpense?.linkedCategory === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="flex flex-col gap-2">
                            <button type="submit" class="w-full bg-teal-600 text-white font-semibold py-3 rounded-lg hover:bg-teal-700 transition action-btn">${isEditing ? 'Mettre à jour' : 'Enregistrer la Dépense'}</button>
                            ${isEditing ? `<button type="button" data-action="cancel-real-expense-edit" class="w-full text-center text-sm text-slate-500 hover:text-slate-700 py-2">Annuler</button>`: ''}
                        </div>
                    </form>
                </div>
            </div>
            <div class="md:col-span-3 space-y-6">
                ${Header('Dépenses Réelles du Mois')}
                <div id="real-expenses-list-container">${RealExpensesList()}</div>
            </div>
        </div>
    `;
}

function RealExpensesList() {
    const realExpenses = getCurrentRealExpenses();
    const total = realExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    return `
    <div class="bg-white p-6 rounded-xl shadow-md">
        <div class="space-y-2 max-h-[26rem] overflow-y-auto pr-2">
            ${realExpenses.length > 0 ? realExpenses.map(exp => `
                <div class="flex justify-between items-center border-b border-slate-200 py-2 text-sm group">
                    <div>
                        <p class="font-medium text-slate-800">${exp.description}</p>
                        <p class="text-xs text-slate-500">${new Date(exp.date).toLocaleDateString('fr-FR')} - <span style="color:${getCategoryColor(exp.linkedCategory)}">${exp.linkedCategory}</span></p>
                    </div>
                    <div class="flex items-center">
                        <span class="font-semibold text-rose-600 mr-4">${formatCurrency(exp.amount)}</span>
                        <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                            <button class="edit-real-expense-btn p-1 text-sky-500 hover:text-sky-700" data-id="${exp.id}" aria-label="Modifier"><i class="fas fa-pencil-alt"></i></button>
                            <button class="delete-real-expense-btn p-1 text-rose-500 hover:text-rose-700" data-id="${exp.id}" aria-label="Supprimer"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                </div>
            `).join('') : '<p class="text-center py-8 text-slate-500">Aucune dépense réelle enregistrée pour ce mois.</p>'}
        </div>
        <div class="font-bold text-base flex justify-between border-t-2 border-slate-300 pt-4 mt-4">
            <span>Total Dépensé</span>
            <span>${formatCurrency(total)}</span>
        </div>
    </div>
    `;
}

function StatsView() {
    const dailyAverage = getCurrentPlannedExpenses().length > 0 ? totalPlannedExpenses() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() : 0;
    const topExpenses = [...getCurrentPlannedExpenses()].sort((a, b) => b.amount - a.amount).slice(0, 5);
    return `
        <div class="space-y-8">
            <div>${Header(`Analyse de votre Planification (${formatMonthForDisplay(uiState.selectedMonth)})`)}</div>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md"><h3 class="text-xl font-semibold text-slate-800 mb-4">Répartition des Dépenses Prévues</h3><div id="stats-pie-chart" class="w-full h-80 relative"></div></div>
                 <div class="space-y-6">
                    <div class="bg-white p-6 rounded-xl shadow-md"><h3 class="text-xl font-semibold text-slate-800 mb-2">Dépense Moyenne Prévue</h3><p class="text-3xl font-bold text-slate-900">${formatCurrency(dailyAverage)} <span class="text-lg font-normal text-slate-500">/ jour</span></p></div>
                    <div class="bg-white p-6 rounded-xl shadow-md">
                        <h3 class="text-xl font-semibold text-slate-800 mb-4">Top 5 Dépenses Prévues</h3>
                        <ul class="space-y-2 text-sm">${topExpenses.map(exp => `<li class="flex justify-between items-center"><span class="text-slate-600">${exp.description} <span class="text-xs text-slate-400">(${exp.category})</span></span><span class="font-semibold text-slate-800">${formatCurrency(exp.amount)}</span></li>`).join('') || '<p class="text-sm text-slate-500">Aucune dépense planifiée.</p>'}</ul>
                    </div>
                 </div>
            </div>
             <div class="bg-white p-6 rounded-xl shadow-md"><h3 class="text-xl font-semibold text-slate-800 mb-4">Revenus vs. Dépenses Prévus</h3><div id="stats-bar-chart" class="w-full h-80 relative"></div></div>
        </div>
    `;
}

function FlowView() {
    return `<div class="space-y-8"><div>${Header(`Analyse des Flux Planifiés (${formatMonthForDisplay(uiState.selectedMonth)})`)}<p class="text-slate-600 mt-2">Visualisez le parcours de votre argent, de vos revenus jusqu'à vos dépenses réelles et le solde restant.</p></div><div class="bg-white p-6 rounded-xl shadow-md"><h3 class="text-xl font-semibold text-slate-800 mb-4">Flux de Budget</h3><div id="flow-sankey-chart" class="w-full h-[600px] relative"></div></div></div>`;
}

function Header(title: string) { return `<h2 class="text-2xl font-bold text-slate-800">${title}</h2>`; }

function BalanceOverview() {
    const income = totalRealIncome();
    const expenses = totalPlannedExpenses();
    const balance = income - expenses;
    const progress = income > 0 ? Math.min((expenses / income) * 100, 100) : 0;
    return `<div class="bg-white p-6 rounded-xl shadow-md"><h3 class="text-lg font-semibold text-slate-800 mb-4">Solde Prévu</h3><p class="text-4xl font-bold ${balance >= 0 ? 'text-teal-600' : 'text-rose-600'}">${formatCurrency(balance)}</p><div class="mt-4"><div class="flex justify-between text-sm text-slate-600 mb-1"><span>Dépenses Prévues</span><span>${formatCurrency(expenses)} / ${formatCurrency(income)}</span></div><div class="w-full bg-slate-200 rounded-full h-2.5"><div class="${progress > 85 ? 'bg-rose-500' : 'bg-teal-500'} h-2.5 rounded-full transition-all duration-500" style="width: ${progress}%"></div></div></div></div>`;
}

function IncomeDetails() {
    const allIncomes = getCurrentIncomes();
    const recurringIncomes = allIncomes.filter(i => i.isRecurring);
    const variableIncomes = allIncomes.filter(i => !i.isRecurring);
    const createIncomeTable = (title: string, data: IncomeSource[], total: number) => {
        const rows = data.length > 0 
            ? data.map(item => {
                const buttons = !item.isRecurring
                    ? `<button class="edit-income-btn p-1 text-sky-500 hover:text-sky-700 opacity-0 group-hover:opacity-100 transition-opacity" data-id="${item.id}" aria-label="Modifier"><i class="fas fa-pencil-alt"></i></button>
                       <button class="delete-income-btn text-rose-400 hover:text-rose-600 px-1 opacity-0 group-hover:opacity-100 transition-opacity" data-id="${item.id}" aria-label="Supprimer"><i class="fas fa-times"></i></button>`
                    : '';
                return `<div class="flex justify-between items-center border-b border-slate-200 py-2 group">
                            <span>${item.description}</span>
                            <div class="flex items-center">
                                <span class="font-medium mr-2">${formatCurrency(item.amount)}</span>
                                ${buttons}
                            </div>
                        </div>`;
            }).join('') 
            : '<p class="text-sm text-slate-500 text-center py-4">Aucun revenu pour le moment.</p>';
        
        return `<div class="space-y-4">
                    <h4 class="font-semibold text-slate-800">${title}</h4>
                    <div class="text-sm space-y-1">${rows}</div>
                    <div class="font-bold flex justify-between pt-2"><span>Total</span><span>${formatCurrency(total)}</span></div>
                </div>`;
    };
    return `<div class="bg-white p-6 rounded-xl shadow-md"><h3 class="text-lg font-semibold text-slate-800 mb-4">Revenus Prévus</h3>${createIncomeTable('FIXES (RÉCURRENTS)', recurringIncomes, recurringIncomes.reduce((sum, i) => sum + i.amount, 0))}<hr class="my-6 border-slate-200">${createIncomeTable('VARIABLES', variableIncomes, variableIncomes.reduce((sum, i) => sum + i.amount, 0))}</div>`;
}

function BudgetDetailTable() {
    const allPlannedExpenses = getCurrentPlannedExpenses();
    const recurringExpenses = allPlannedExpenses.filter(e => e.isRecurring);
    const variableExpenses = allPlannedExpenses.filter(e => !e.isRecurring);
    const renderCategoryTable = (title: string, expenses: Expense[]) => {
        const expensesByCategory = expenses.reduce((acc, expense) => { acc[expense.category] = (acc[expense.category] || 0) + expense.amount; return acc; }, {} as { [key: string]: number });
        const relevantCategories = globalState.categories.filter(cat => expenses.some(exp => exp.category === cat.name));
        return `<div><h4 class="text-lg font-semibold text-slate-800 mb-2">${title}</h4><div class="w-full text-sm"><div class="grid grid-cols-4 text-xs text-slate-500 font-medium pb-2 border-b border-slate-200"><span class="col-span-2">CATÉGORIE</span><span class="text-right">DÉPENSÉ / PRÉVU</span><span class="text-right">RESTANT</span></div><div class="budget-table-body">${relevantCategories.length > 0 ? relevantCategories.map(cat => { const planned = expensesByCategory[cat.name] || 0; const spent = getCurrentRealExpenses().filter(re => re.linkedCategory === cat.name).reduce((sum, re) => sum + re.amount, 0); const remaining = planned - spent; const isExpanded = uiState.expandedCategory === cat.name; const overspent = remaining < 0; return `<div class="border-b border-slate-200"><div class="grid grid-cols-4 items-center py-3 hover:bg-slate-50 cursor-pointer" data-category-name="${cat.name}"><div class="col-span-2 flex items-center gap-3"><span class="w-3 h-3 rounded-full" style="background-color: ${getCategoryColor(cat.name)}"></span><span class="font-medium text-slate-700">${cat.name}</span></div><div class="text-right"><span class="font-medium ${overspent ? 'text-rose-500' : 'text-slate-600'}">${formatCurrency(spent)}</span><span class="text-slate-400"> / ${formatCurrency(planned)}</span></div><div class="flex items-center justify-end gap-2"><span class="font-medium ${overspent ? 'text-rose-600' : 'text-slate-900'}">${formatCurrency(remaining)}</span><i class="fas fa-chevron-down text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}"></i></div></div>${isExpanded ? renderExpenseRowsForCategory(cat.name, expenses) : ''}</div>`; }).join('') : `<div class="text-center py-8 text-slate-500"><i class="fas fa-folder-open fa-2x mb-2 text-slate-300"></i><p>Aucune dépense planifiée dans cette section.</p></div>`}</div><div class="font-bold flex justify-end pt-2 mt-2"><span>Total: ${formatCurrency(expenses.reduce((sum, e) => sum + e.amount, 0))}</span></div></div></div>`;
    }
    return `<div class="bg-white p-6 rounded-xl shadow-md space-y-8">${renderCategoryTable('DÉPENSES FIXES PRÉVUES (RÉCURRENTES)', recurringExpenses)}${renderCategoryTable('DÉPENSES VARIABLES PRÉVUES', variableExpenses)}<div class="font-bold text-base flex justify-between border-t-2 border-slate-300 pt-4"><span>Total général des dépenses prévues</span><span>${formatCurrency(totalPlannedExpenses())}</span></div></div>`;
}

function renderExpenseRowsForCategory(categoryName: string, expenseList: Expense[]) {
    const expensesInCategory = expenseList.filter(e => e.category === categoryName);
    return `<div class="bg-slate-50 text-xs text-slate-600 animate-fade-in divide-y divide-slate-200">${expensesInCategory.map(exp => {
        const buttons = !exp.isRecurring
            ? `<button class="edit-expense-btn p-1 text-sky-500 hover:text-sky-700" data-id="${exp.id}" aria-label="Modifier"><i class="fas fa-pencil-alt"></i></button>
               <button class="delete-expense-btn p-1 text-rose-500 hover:text-rose-700" data-id="${exp.id}" aria-label="Supprimer"><i class="fas fa-trash-alt"></i></button>`
            : '';
        return `<div class="flex justify-between items-center p-2 pl-6">
                    <span>${exp.description}</span>
                    <div class="flex items-center">
                        <span class="mr-4 font-medium">${formatCurrency(exp.amount)}</span>
                        ${buttons}
                    </div>
                </div>`;
    }).join('')}</div>`;
}

function TransactionModal() {
    if (!uiState.isTransactionModalOpen) return '';
    const isEditing = uiState.editingTransaction !== null;
    const transaction = uiState.editingTransaction;
    const type = isEditing ? transaction!.type : uiState.transactionModalType;
    const isExpense = type === 'expense';
    const title = isEditing ? (isExpense ? 'Modifier Dépense Prévue' : 'Modifier Revenu Prévu') : 'Ajouter une Transaction Planifiée';
    return `<div id="transaction-modal-backdrop" class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"><div class="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md m-4 animate-scale-up"><div class="flex justify-between items-center mb-4"><h3 class="text-xl font-semibold text-slate-800">${title}</h3><button data-action="close-modal" class="text-slate-500 hover:text-slate-800 p-2 -mr-2 -mt-2" aria-label="Fermer"><i class="fas fa-times"></i></button></div><form id="transaction-form" class="space-y-4">${!isEditing ? `<div class="flex gap-2 rounded-lg bg-slate-100 p-1"><button type="button" data-type="expense" class="transaction-type-btn flex-1 p-2 text-sm font-semibold rounded-md ${isExpense ? 'bg-white shadow' : 'text-slate-500'}">Dépense</button><button type="button" data-type="income" class="transaction-type-btn flex-1 p-2 text-sm font-semibold rounded-md ${!isExpense ? 'bg-white shadow' : 'text-slate-500'}">Revenu</button></div>` : ''}<div><label for="transaction-description" class="block text-sm font-medium text-slate-600 mb-1">Description</label><input type="text" id="transaction-description" required class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500" placeholder="Ex: Restaurant" value="${transaction?.description || ''}"></div><div><label for="transaction-amount" class="block text-sm font-medium text-slate-600 mb-1">Montant (€)</label><input type="number" id="transaction-amount" required step="0.01" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500" placeholder="Ex: 45.50" value="${transaction?.amount || ''}"></div><div id="category-wrapper" class="${isExpense ? '' : 'hidden'}"><label for="transaction-category" class="block text-sm font-medium text-slate-600 mb-1">Catégorie</label><div class="flex items-center space-x-2"><select id="transaction-category" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500">${globalState.categories.map(c => `<option value="${c.name}" ${transaction?.type === 'expense' && transaction.category === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select><button type="button" id="suggest-category-btn" class="p-2 bg-sky-100 text-sky-600 rounded-lg hover:bg-sky-200 transition" aria-label="Suggérer une catégorie">${uiState.isSuggesting ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-wand-magic-sparkles"></i>'}</button></div></div><button type="submit" class="w-full bg-sky-600 text-white font-semibold py-3 rounded-lg hover:bg-sky-700 transition action-btn">${isEditing ? 'Mettre à jour' : 'Ajouter'}</button></form></div></div>`;
}

function CategoryManagerModal() {
    if (!uiState.isCategoryModalOpen) return '';
    return `<div id="category-modal-backdrop" class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"><div class="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg m-4 animate-scale-up"><div class="flex justify-between items-center mb-6"><h3 class="text-2xl font-semibold text-slate-800">Gérer les Catégories</h3><button data-action="close-modal" class="text-slate-500 hover:text-slate-800 p-2 -mr-2 -mt-2" aria-label="Fermer"><i class="fas fa-times fa-lg"></i></button></div><div class="space-y-4"><form id="add-category-form" class="flex gap-2 items-end"><div class="flex-grow"><label class="text-sm font-medium text-slate-600">Nom de la Catégorie</label><input type="text" id="new-category-name" placeholder="Ex: Factures" required class="w-full p-2 text-sm border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-teal-500"></div><button type="submit" class="bg-teal-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-teal-700 transition action-btn">Ajouter</button></form><div id="category-list" class="space-y-2 max-h-64 overflow-y-auto pr-2">${globalState.categories.map(cat => `<div class="flex justify-between items-center p-2 bg-slate-50 rounded-md"><div class="flex items-center gap-3"><input type="color" value="${cat.color}" class="p-0 h-6 w-6 border-none bg-transparent rounded-md cursor-pointer" data-category-name="${cat.name}"><p class="font-medium text-sm text-slate-700">${cat.name}</p></div><button class="delete-category-btn text-rose-400 hover:text-rose-600 px-2" data-category-name="${cat.name}" aria-label="Supprimer"><i class="fas fa-trash-alt"></i></button></div>`).join('')}</div></div></div></div>`;
}

const renderRecurringList = (items: (IncomeSource | Expense)[], type: 'income' | 'expense') => {
    if (items.length === 0) return '<p class="text-sm text-slate-500 text-center py-4">Aucun élément.</p>';
    return items.map(item => `
        <div class="flex justify-between items-center p-2 bg-slate-50 rounded-md text-sm group">
            <span>${item.description} - ${formatCurrency(item.amount)}</span>
            <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="edit-recurring-btn text-sky-500 hover:text-sky-700 px-2" data-id="${item.id}" data-type="${type}" aria-label="Modifier"><i class="fas fa-pencil-alt"></i></button>
                <button class="delete-recurring-btn text-rose-400 hover:text-rose-600 px-2" data-id="${item.id}" data-type="${type}" aria-label="Supprimer"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`).join('');
};

function RecurringModal() {
    if (!uiState.isRecurringModalOpen) return '';
    const isEditing = uiState.editingRecurringTransaction !== null;
    const transaction = uiState.editingRecurringTransaction;
    const type = isEditing ? transaction!.type : uiState.recurringModalType;
    const isExpense = type === 'expense';
    const formTitle = isEditing ? 'Modifier la Transaction' : 'Ajouter une Transaction Récurrente';

    return `<div id="recurring-modal-backdrop" class="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"><div class="bg-white p-6 rounded-xl shadow-lg w-full max-w-4xl m-4 animate-scale-up"><div class="flex justify-between items-center mb-6"><h3 class="text-2xl font-semibold text-slate-800">Gérer les Transactions Récurrentes</h3><button data-action="close-modal" class="text-slate-500 hover:text-slate-800 p-2 -mr-2 -mt-2" aria-label="Fermer"><i class="fas fa-times fa-lg"></i></button></div><div class="grid grid-cols-1 md:grid-cols-2 gap-8"><div class="space-y-4"><h4 class="text-lg font-semibold text-slate-800">${formTitle}</h4><form id="recurring-form" class="space-y-4"><div class="flex gap-2 rounded-lg bg-slate-100 p-1"><button type="button" data-type="expense" class="recurring-type-btn flex-1 p-2 text-sm font-semibold rounded-md ${isExpense ? 'bg-white shadow' : 'text-slate-500'}">Dépense</button><button type="button" data-type="income" class="recurring-type-btn flex-1 p-2 text-sm font-semibold rounded-md ${!isExpense ? 'bg-white shadow' : 'text-slate-500'}">Revenu</button></div><div><label class="block text-sm font-medium text-slate-600 mb-1">Description</label><input type="text" id="recurring-description" required class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500" value="${transaction?.description || ''}"></div><div><label class="block text-sm font-medium text-slate-600 mb-1">Montant (€)</label><input type="number" id="recurring-amount" required step="0.01" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500" value="${transaction?.amount || ''}"></div><div id="recurring-category-wrapper" class="${isExpense ? '' : 'hidden'}"><label class="block text-sm font-medium text-slate-600 mb-1">Catégorie</label><select id="recurring-category" class="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500">${globalState.categories.map(c => `<option value="${c.name}" ${transaction?.type === 'expense' && transaction.category === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div><div class="flex gap-2"><button type="submit" class="flex-grow bg-sky-600 text-white font-semibold py-2.5 rounded-lg hover:bg-sky-700 transition">${isEditing ? 'Mettre à jour' : 'Ajouter'}</button>${isEditing ? `<button type="button" data-action="cancel-recurring-edit" class="bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-300">Annuler</button>` : ''}</div></form></div><div class="space-y-6"><div class="space-y-2"><h4 class="text-lg font-semibold text-teal-800">Revenus Récurrents</h4><div id="recurring-incomes-list" class="space-y-2 max-h-60 overflow-y-auto pr-2">${renderRecurringList(globalState.recurringIncomes, 'income')}</div></div><div class="space-y-2"><h4 class="text-lg font-semibold text-rose-800">Dépenses Récurrentes</h4><div id="recurring-expenses-list" class="space-y-2 max-h-60 overflow-y-auto pr-2">${renderRecurringList(globalState.recurringExpenses, 'expense')}</div></div></div></div></div></div>`;
}

// --- EVENT HANDLERS & LOGIC ---
function closeModal() {
    uiState.isTransactionModalOpen = false;
    uiState.isRecurringModalOpen = false;
    uiState.isCategoryModalOpen = false;
    uiState.editingTransaction = null;
    uiState.editingRecurringTransaction = null;
    uiState.isSuggesting = false;
    updateModals();
}

function cancelRealExpenseEdit() {
    uiState.editingRealExpense = null;
    updateTabContent(); // Re-render the tab to reset the form
}

function handleAddRealExpense(e: Event) {
    e.preventDefault();
    const description = (document.getElementById('real-expense-description') as HTMLInputElement).value;
    const amount = parseFloat((document.getElementById('real-expense-amount') as HTMLInputElement).value);
    const date = (document.getElementById('real-expense-date') as HTMLInputElement).value;
    const linkedCategory = (document.getElementById('real-expense-category') as HTMLSelectElement).value;

    if (!description || isNaN(amount) || !date || !linkedCategory) {
        alert("Veuillez remplir tous les champs.");
        return;
    }

    if (uiState.editingRealExpense) {
        const expense = getCurrentRealExpenses().find(exp => exp.id === uiState.editingRealExpense!.id);
        if (expense) {
            Object.assign(expense, { description, amount, date, linkedCategory });
        }
    } else {
        const newRealExpense: RealExpense = { id: Date.now(), description, amount, date, linkedCategory };
        getCurrentRealExpenses().push(newRealExpense);
    }
    
    saveDataToLocalStorage();
    cancelRealExpenseEdit(); // Reset form and editing state
    
    // Update relevant parts of the UI
    updateRealExpensesList();
    updateBudgetDetailTable();
    updateCharts();
}


function handleTransactionFormSubmit(e: Event) {
    e.preventDefault();
    const description = (document.getElementById('transaction-description') as HTMLInputElement).value;
    const amount = parseFloat((document.getElementById('transaction-amount') as HTMLInputElement).value);
    const type = uiState.editingTransaction ? uiState.editingTransaction.type : uiState.transactionModalType;

    if (type === 'expense') {
        const category = (document.getElementById('transaction-category') as HTMLSelectElement).value;
        if (uiState.editingTransaction) {
            const index = getCurrentPlannedExpenses().findIndex(exp => exp.id === uiState.editingTransaction!.id);
            if (index !== -1) monthlyData[uiState.selectedMonth].plannedExpenses[index] = { ...getCurrentPlannedExpenses()[index], description, amount, category };
        } else {
            getCurrentPlannedExpenses().push({ id: Date.now(), description, amount, category, isRecurring: false });
        }
    } else { // income
        if (uiState.editingTransaction) {
            const index = getCurrentIncomes().findIndex(inc => inc.id === uiState.editingTransaction!.id);
            if (index !== -1) monthlyData[uiState.selectedMonth].realIncome[index] = { ...getCurrentIncomes()[index], description, amount };
        } else {
             getCurrentIncomes().push({ id: Date.now(), description, amount, isRecurring: false });
        }
    }
    
    closeModal();
    saveDataToLocalStorage();
    updateBalanceOverview();
    updateIncomeDetails();
    updateBudgetDetailTable();
    updateCharts();
}

function handleRecurringFormSubmit(e: Event) {
    e.preventDefault();
    const description = (document.getElementById('recurring-description') as HTMLInputElement).value;
    const amount = parseFloat((document.getElementById('recurring-amount') as HTMLInputElement).value);
    if (!description || isNaN(amount)) return;
    
    const isEditing = uiState.editingRecurringTransaction !== null;
    const type = isEditing ? uiState.editingRecurringTransaction!.type : uiState.recurringModalType;
    const currentMonthKey = uiState.selectedMonth;

    if (isEditing) { // --- UPDATE LOGIC ---
        const { id } = uiState.editingRecurringTransaction!;
        if (type === 'income') {
            const index = globalState.recurringIncomes.findIndex(i => i.id === id);
            if (index !== -1) globalState.recurringIncomes[index] = { ...globalState.recurringIncomes[index], description, amount };
        } else { // expense
            const category = (document.getElementById('recurring-category') as HTMLSelectElement).value;
            const index = globalState.recurringExpenses.findIndex(exp => exp.id === id);
            if (index !== -1) globalState.recurringExpenses[index] = { ...globalState.recurringExpenses[index], description, amount, category };
        }

        Object.keys(monthlyData).forEach(monthKey => {
            if (monthKey >= currentMonthKey) {
                if (type === 'income') {
                    const instanceIndex = monthlyData[monthKey].realIncome.findIndex(i => i.recurringId === id);
                    if (instanceIndex !== -1) Object.assign(monthlyData[monthKey].realIncome[instanceIndex], { description, amount });
                } else {
                    const category = (document.getElementById('recurring-category') as HTMLSelectElement).value;
                    const instanceIndex = monthlyData[monthKey].plannedExpenses.findIndex(exp => exp.recurringId === id);
                    if (instanceIndex !== -1) Object.assign(monthlyData[monthKey].plannedExpenses[instanceIndex], { description, amount, category });
                }
            }
        });

    } else { // --- ADD LOGIC ---
        if (type === 'income') {
            const newRecurring = { id: Date.now(), description, amount };
            globalState.recurringIncomes.push(newRecurring);
            Object.keys(monthlyData).forEach(monthKey => {
                if (monthKey >= currentMonthKey) {
                    monthlyData[monthKey].realIncome.push({ ...newRecurring, id: Date.now() + Math.random(), isRecurring: true, recurringId: newRecurring.id });
                }
            });
        } else { // expense
            const category = (document.getElementById('recurring-category') as HTMLSelectElement).value;
            const newRecurring = { id: Date.now(), description, amount, category };
            globalState.recurringExpenses.push(newRecurring);
            Object.keys(monthlyData).forEach(monthKey => {
                if (monthKey >= currentMonthKey) {
                    monthlyData[monthKey].plannedExpenses.push({ ...newRecurring, id: Date.now() + Math.random(), isRecurring: true, recurringId: newRecurring.id });
                }
            });
        }
    }
    
    saveDataToLocalStorage();
    (e.target as HTMLFormElement).reset();
    uiState.editingRecurringTransaction = null;
    updateModals(); // To reset form state and title
    updateRecurringModalLists(); // Update lists inside the modal
    updateAll(); // Update main UI
}

function handleDeleteRecurring(id: number, type: 'income' | 'expense') {
    const currentMonthKey = uiState.selectedMonth;

    Object.keys(monthlyData).forEach(monthKey => {
        if (monthKey >= currentMonthKey) {
            if (type === 'income') {
                monthlyData[monthKey].realIncome = monthlyData[monthKey].realIncome.filter(i => i.recurringId !== id);
            } else {
                monthlyData[monthKey].plannedExpenses = monthlyData[monthKey].plannedExpenses.filter(e => e.recurringId !== id);
            }
        }
    });

    if (type === 'income') {
        globalState.recurringIncomes = globalState.recurringIncomes.filter(i => i.id !== id);
    } else {
        globalState.recurringExpenses = globalState.recurringExpenses.filter(e => e.id !== id);
    }

    saveDataToLocalStorage();
    updateRecurringModalLists();
    updateAll();
}

function handleDeleteRealExpense(id: number) {
    monthlyData[uiState.selectedMonth].realExpenses = getCurrentRealExpenses().filter(exp => exp.id !== id);
    saveDataToLocalStorage();
    updateRealExpensesList();
    updateBudgetDetailTable();
    updateCharts();
}


function attachGlobalEventListeners() {
    const root = document.getElementById('root');
    if (!root) return;

    root.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest<HTMLElement>('[data-action], .tab-btn, .delete-recurring-btn, .edit-recurring-btn, .transaction-type-btn, .recurring-type-btn, [data-category-name], .edit-expense-btn, .delete-expense-btn, .edit-income-btn, .delete-income-btn, .delete-category-btn, #suggest-category-btn, .edit-real-expense-btn, .delete-real-expense-btn');

        if (target.id.includes('-backdrop')) { closeModal(); return; }
        if (!button) return;

        // Modals & Actions
        if(button.dataset.action === 'open-transaction-modal') { uiState.isTransactionModalOpen = true; uiState.transactionModalType = 'expense'; updateModals(); }
        if(button.dataset.action === 'open-recurring-modal') { uiState.isRecurringModalOpen = true; uiState.recurringModalType = 'expense'; uiState.editingRecurringTransaction = null; updateModals(); }
        if(button.dataset.action === 'open-category-modal') { uiState.isCategoryModalOpen = true; updateModals(); }
        if(button.dataset.action === 'close-modal') { closeModal(); }
        if(button.dataset.action === 'cancel-recurring-edit') { uiState.editingRecurringTransaction = null; updateModals(); }
        if(button.dataset.action === 'cancel-real-expense-edit') { cancelRealExpenseEdit(); }

        if(button.dataset.action === 'prev-month' || button.dataset.action === 'next-month') {
            const [year, month] = uiState.selectedMonth.split('-').map(Number);
            const currentDate = new Date(year, month - 1, 15);
            const direction = button.dataset.action === 'prev-month' ? -1 : 1;
            currentDate.setMonth(currentDate.getMonth() + direction);
            const newMonthKey = getMonthKey(currentDate);
            if (!monthlyData[newMonthKey]) {
                monthlyData[newMonthKey] = createMonthDataFromRecurring();
                saveDataToLocalStorage();
            }
            uiState.selectedMonth = newMonthKey;
            uiState.expandedCategory = null;
            updateTabContent(); // Re-render content for new month
            updateAll();
        }

        // Tabs
        const tabName = button.dataset.tab as 'budget' | 'tracking' | 'stats' | 'flow';
        if (tabName && uiState.activeTab !== tabName) { uiState.activeTab = tabName; updateTabs(); updateTabContent(); return; }

        // Modal Type Switches
        if (button.classList.contains('transaction-type-btn')) { uiState.transactionModalType = button.dataset.type as TransactionType; updateModals(); return; }
        if (button.classList.contains('recurring-type-btn')) { uiState.recurringModalType = button.dataset.type as TransactionType; if(uiState.editingRecurringTransaction) { uiState.editingRecurringTransaction = null; } updateModals(); return; }

        // Budget Table Interactions
        if (button.dataset.categoryName && !button.classList.contains('delete-category-btn') && !target.closest('input[type="color"]')) {
            uiState.expandedCategory = uiState.expandedCategory === button.dataset.categoryName ? null : button.dataset.categoryName;
            updateBudgetDetailTable();
        }
        if(button.classList.contains('edit-expense-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            const expense = getCurrentPlannedExpenses().find(exp => exp.id === id);
            if (expense) { uiState.editingTransaction = {...expense, type: 'expense'}; uiState.isTransactionModalOpen = true; updateModals(); }
        }
        if(button.classList.contains('delete-expense-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            if (confirm('Supprimer cette dépense planifiée ?')) {
                monthlyData[uiState.selectedMonth].plannedExpenses = getCurrentPlannedExpenses().filter(exp => exp.id !== id);
                saveDataToLocalStorage(); updateBudgetDetailTable(); updateBalanceOverview(); updateCharts();
            }
        }
        if(button.classList.contains('edit-income-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            const income = getCurrentIncomes().find(inc => inc.id === id);
            if (income) { uiState.editingTransaction = {...income, type: 'income'}; uiState.isTransactionModalOpen = true; updateModals(); }
        }
        if(button.classList.contains('delete-income-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            monthlyData[uiState.selectedMonth].realIncome = getCurrentIncomes().filter(item => item.id !== id);
            saveDataToLocalStorage(); updateIncomeDetails(); updateBalanceOverview(); updateCharts();
        }

        // Category Manager
        if(button.classList.contains('delete-category-btn')) { if (button.dataset.categoryName) handleDeleteCategory(button.dataset.categoryName); }

        // Recurring Manager
        if (button.classList.contains('edit-recurring-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            const type = button.dataset.type as 'income' | 'expense';
            if (type === 'income') {
                const item = globalState.recurringIncomes.find(i => i.id === id);
                if (item) { uiState.editingRecurringTransaction = { ...item, type: 'income' }; uiState.recurringModalType = type; updateModals(); }
            } else {
                const item = globalState.recurringExpenses.find(e => e.id === id);
                if (item) { uiState.editingRecurringTransaction = { ...item, type: 'expense' }; uiState.recurringModalType = type; updateModals(); }
            }
        }
        if (button.classList.contains('delete-recurring-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            const type = button.dataset.type as 'income' | 'expense';
            if (confirm('Supprimer cet élément récurrent ? Cette action sera appliquée à ce mois et aux mois futurs.')) {
                handleDeleteRecurring(id, type);
            }
        }

        // Real Expense CRUD
        if (button.classList.contains('edit-real-expense-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            const expense = getCurrentRealExpenses().find(exp => exp.id === id);
            if (expense) {
                uiState.editingRealExpense = expense;
                updateTabContent();
            }
        }
        if (button.classList.contains('delete-real-expense-btn')) {
            const id = parseInt(button.dataset.id!, 10);
            if (confirm('Supprimer cette dépense réelle ?')) {
                handleDeleteRealExpense(id);
            }
        }

        if (button.id === 'suggest-category-btn') handleSuggestCategory();
    });

    root.addEventListener('submit', (e) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        if(form.id === 'transaction-form') handleTransactionFormSubmit(e);
        if(form.id === 'add-category-form') handleAddCategory(e);
        if(form.id === 'recurring-form') handleRecurringFormSubmit(e);
        if(form.id === 'add-real-expense-form') handleAddRealExpense(e);
    });

    root.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.type === 'color' && target.dataset.categoryName) {
            const categoryName = target.dataset.categoryName;
            const newColor = target.value;
            const category = globalState.categories.find(c => c.name === categoryName);
            if (category) { category.color = newColor; saveDataToLocalStorage(); updateAll(); }
        }
    });
}


function handleAddCategory(event: Event) {
    event.preventDefault();
    const nameInput = document.getElementById('new-category-name') as HTMLInputElement;
    const name = nameInput.value.trim();
    if (name && !globalState.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        globalState.categories.push({ name, color: '#94a3b8' });
        sortCategories();
        saveDataToLocalStorage();
        (event.target as HTMLFormElement).reset();
        updateModals();
    } else { alert('Ce nom de catégorie est invalide ou existe déjà.'); }
}

function handleDeleteCategory(categoryName: string) {
    const isUsedInPlanned = Object.values(monthlyData).some(data => data.plannedExpenses.some(e => e.category === categoryName));
    const isUsedInReal = Object.values(monthlyData).some(data => data.realExpenses.some(e => e.linkedCategory === categoryName));
    const isUsedInRecurring = globalState.recurringExpenses.some(e => e.category === categoryName);

    if (isUsedInPlanned || isUsedInRecurring || isUsedInReal) { 
        const usageInfo = [];
        if (isUsedInPlanned) usageInfo.push("dépenses planifiées");
        if (isUsedInReal) usageInfo.push("dépenses réelles");
        if (isUsedInRecurring) usageInfo.push("dépenses récurrentes");
        alert(`Impossible de supprimer "${categoryName}" car elle est utilisée dans des ${usageInfo.join(', ')}. Veuillez d'abord modifier ou supprimer ces transactions.`); 
        return; 
    }

    if (confirm(`Êtes-vous sûr de vouloir supprimer la catégorie "${categoryName}" ?`)) {
        globalState.categories = globalState.categories.filter(c => c.name !== categoryName);
        saveDataToLocalStorage(); 
        updateModals();
        updateAll();
    }
}

const handleSuggestCategory = async () => {
    const descriptionInput = document.getElementById('transaction-description') as HTMLInputElement;
    const description = descriptionInput.value.trim();
    if (!description) { alert('Veuillez d\'abord entrer une description.'); return; }
    uiState.isSuggesting = true;
    updateModals();
    try {
        const categoryNames = globalState.categories.map(c => c.name).join(', ');
        const prompt = `Étant donné la description de la dépense suivante : "${description}", et la liste de catégories disponibles : [${categoryNames}], quelle est la catégorie la plus appropriée ? Ne renvoyez que le nom exact de la catégorie de la liste.`;
        // FIX: Added explicit GenerateContentResponse type to the API call result for better type safety and to resolve potential type inference issues.
        const response: GenerateContentResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        const suggestedCategory = response.text.trim();
        const categorySelect = document.getElementById('transaction-category') as HTMLSelectElement;
        const categoryExists = globalState.categories.some(c => c.name === suggestedCategory);
        if (categorySelect && categoryExists) { categorySelect.value = suggestedCategory; } 
        else { alert(`La catégorie suggérée "${suggestedCategory}" n'est pas valide.`); }
    } catch (error) {
        console.error('Erreur de suggestion de catégorie:', error);
        alert('Désolé, une erreur s\'est produite lors de la suggestion d\'une catégorie.');
    } finally {
        uiState.isSuggesting = false;
        updateModals();
    }
};

const renderCharts = () => {
    const renderPieChart = (containerId: string) => {
        const chartContainer = document.getElementById(containerId);
        if (!chartContainer) return;
        chartContainer.innerHTML = '';
        const expensesByCategory = getCurrentPlannedExpenses().reduce((acc, expense) => { acc[expense.category] = (acc[expense.category] || 0) + expense.amount; return acc; }, {} as { [key: string]: number });
        const chartData = Object.keys(expensesByCategory).map(key => ({ name: key, value: expensesByCategory[key] }));
        if (chartData.length === 0) { chartContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400"><p>Aucune dépense à afficher.</p></div>'; return; }
        const width = chartContainer.clientWidth, height = chartContainer.clientHeight, radius = Math.min(width, height) / 2.5;
        const svg = d3.select(chartContainer).append('svg').attr('width', width).attr('height', height).append('g').attr('transform', `translate(${width / 3}, ${height / 2})`);
        const pie = d3.pie<{ name: string; value: number }>().value(d => d.value).sort(null);
        const arc = d3.arc<any>().innerRadius(radius * 0.5).outerRadius(radius);
        const tooltip = d3.select(chartContainer).append("div").style("opacity", 0).attr("class", "absolute bg-slate-800 text-white p-2 rounded-lg shadow-lg text-xs pointer-events-none").style("transform", "translateY(-100%)");
        // FIX: Added MouseEvent type to d3 event handlers to correctly type the 'event' object and allow access to properties like pageX and pageY.
        const arcs = svg.selectAll('arc').data(pie(chartData)).enter().append('g').attr('class', 'arc').on("mouseover", function (this: any, event: MouseEvent, d) { d3.select(this).select('path').transition().duration(200).attr('d', d3.arc<any>().innerRadius(radius * 0.5).outerRadius(radius * 1.05)); tooltip.style("opacity", 1); }).on("mousemove", (event: MouseEvent, d) => { tooltip.html(`<b>${d.data.name}</b><br>${formatCurrency(d.data.value)} (${((d.data.value/totalPlannedExpenses())*100).toFixed(1)}%)`).style("left", (event.pageX - chartContainer.getBoundingClientRect().left + 10) + "px").style("top", (event.pageY - chartContainer.getBoundingClientRect().top - 10) + "px"); }).on("mouseleave", function (this: any, event: MouseEvent, d) { d3.select(this).select('path').transition().duration(200).attr('d', arc); tooltip.style("opacity", 0); });
        arcs.append('path').attr('d', arc).attr('fill', d => getCategoryColor(d.data.name));
        const legend = svg.selectAll('.legend').data(chartData).enter().append('g').attr('class', 'legend').attr('transform', (d, i) => `translate(${radius + 40}, ${-radius + i * 22})`);
        legend.append('rect').attr('width', 12).attr('height', 12).attr('rx', 2).style('fill', d => getCategoryColor(d.name));
        legend.append('text').attr('x', 18).attr('y', 10).attr('class', 'text-sm text-slate-600').text(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name);
    };

    const renderBarChart = (containerId: string) => {
        const chartContainer = document.getElementById(containerId);
        if (!chartContainer) return;
        chartContainer.innerHTML = '';
        const data = [{ name: 'Total', revenues: totalRealIncome(), expenses: totalPlannedExpenses() }];
        const margin = { top: 20, right: 30, bottom: 30, left: 60 }, width = chartContainer.clientWidth - margin.left - margin.right, height = chartContainer.clientHeight - margin.top - margin.bottom;
        const svg = d3.select(chartContainer).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom).append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);
        const subgroups = ['revenues', 'expenses'];
        const y = d3.scaleLinear().domain([0, Math.max(totalRealIncome(), totalPlannedExpenses()) * 1.1]).range([height, 0]);
        svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d => formatCurrency(d as number).replace(/\s€/g, ''))).call(g => g.select(".domain").remove()).selectAll(".tick line").clone().attr("x2", width).attr("stroke-opacity", 0.1);
        const x = d3.scaleBand().domain(subgroups).range([0, width]).padding(0.2);
        const color = d3.scaleOrdinal().domain(subgroups).range(['#14b8a6', '#f43f5e']);
        const tooltip = d3.select(chartContainer).append("div").style("opacity", 0).attr("class", "absolute bg-slate-800 text-white p-2 rounded-lg shadow-lg text-xs pointer-events-none").style("transform", "translateY(-100%)");
        // FIX: Added MouseEvent type to d3 event handlers to correctly type the 'event' object.
        svg.append("g").selectAll("rect").data(subgroups).join("rect").attr("x", d => x(d)!).attr("y", d => y(data[0][d as keyof typeof data[0]] as number)).attr("width", x.bandwidth()).attr("height", d => height - y(data[0][d as keyof typeof data[0]] as number)).attr("fill", d => color(d) as string).attr('rx', 4).on("mouseover", (event: MouseEvent, d) => tooltip.style("opacity", 1)).on("mousemove", (event: MouseEvent, d) => { const value = data[0][d as keyof typeof data[0]]; tooltip.html(`<b>${d === 'revenues' ? 'Revenus' : 'Dépenses'}</b>: ${formatCurrency(value as number)}`).style("left", (event.pageX - chartContainer.getBoundingClientRect().left + 15) + "px").style("top", (event.pageY - chartContainer.getBoundingClientRect().top - 15) + "px"); }).on("mouseleave", () => tooltip.style("opacity", 0));
    };

    const renderSankeyChart = (containerId: string) => {
        const chartContainer = document.getElementById(containerId);
        if (!chartContainer) return;
        chartContainer.innerHTML = '';
        if (getCurrentIncomes().length === 0 && getCurrentPlannedExpenses().length === 0) { chartContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400"><p>Aucune donnée pour ce mois.</p></div>'; return; }
        
        const data = (() => {
            const nodes: { name: string }[] = [];
            const links: { source: string; target: string; value: number }[] = [];
            const nodeSet = new Set<string>();
            const addNode = (name: string) => { if (!nodeSet.has(name)) { nodeSet.add(name); nodes.push({ name }); } };

            const plannedExpensesByCategory = getCurrentPlannedExpenses().reduce((acc, expense) => {
                acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
                return acc;
            }, {} as { [key: string]: number });

            const realExpensesByCategory = getCurrentRealExpenses().reduce((acc, expense) => {
                if (!acc[expense.linkedCategory]) acc[expense.linkedCategory] = [];
                acc[expense.linkedCategory].push(expense);
                return acc;
            }, {} as { [key: string]: RealExpense[] });

            addNode('Budget');
            getCurrentIncomes().forEach(income => {
                addNode(income.description);
                links.push({ source: income.description, target: 'Budget', value: income.amount });
            });

            Object.entries(plannedExpensesByCategory).forEach(([category, amount]) => {
                if (amount > 0) {
                    const plannedNodeName = `${category}`;
                    addNode(plannedNodeName);
                    links.push({ source: 'Budget', target: plannedNodeName, value: amount });

                    const realExpensesInCat = realExpensesByCategory[category] || [];
                    let totalSpentInCat = 0;
                    realExpensesInCat.forEach(realExpense => {
                        addNode(realExpense.description);
                        links.push({ source: plannedNodeName, target: realExpense.description, value: realExpense.amount });
                        totalSpentInCat += realExpense.amount;
                    });
                    
                    const remaining = amount - totalSpentInCat;
                    if (remaining > 0.01) { // Use a small epsilon to avoid tiny rounding error nodes
                        const remainingNodeName = `Restant (${category})`;
                        addNode(remainingNodeName);
                        links.push({ source: plannedNodeName, target: remainingNodeName, value: remaining });
                    }
                }
            });

            const unallocatedBudget = totalRealIncome() - totalPlannedExpenses();
            if (unallocatedBudget > 0.01) {
                addNode('Budget non alloué');
                links.push({ source: 'Budget', target: 'Budget non alloué', value: unallocatedBudget });
            }
            return { nodes, links };
        })();

        const margin = { top: 20, right: 150, bottom: 20, left: 150 }, width = chartContainer.clientWidth - margin.left - margin.right, height = chartContainer.clientHeight - margin.top - margin.bottom;
        const svg = d3.select(chartContainer).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom).append('g').attr('transform', `translate(${margin.left},${margin.top})`);
        const sankeyLayout = sankey().nodeId((d: any) => d.name).nodeWidth(15).nodePadding(10).extent([[1, 5], [width - 1, height - 5]]);
        const { nodes, links } = sankeyLayout(data as any);
        const tooltip = d3.select(chartContainer).append("div").style("opacity", 0).attr("class", "absolute bg-slate-800 text-white p-2 rounded-lg shadow-lg text-xs pointer-events-none");
        // FIX: Added MouseEvent type to d3 event handlers to correctly type the 'event' object.
        svg.append('g').selectAll('rect').data(nodes).join('rect').attr('x', (d: any) => d.x0).attr('y', (d: any) => d.y0).attr('height', (d: any) => d.y1 - d.y0).attr('width', (d: any) => d.x1 - d.x0).attr('fill', (d: any) => getCategoryColor(d.name.replace(/ \(.*\)$/, ''))).on("mouseover", (event: MouseEvent, d: any) => tooltip.style("opacity", 1)).on("mousemove", (event: MouseEvent, d: any) => { tooltip.html(`<b>${d.name}</b><br>${formatCurrency(d.value)}`).style("left", (event.pageX - chartContainer.getBoundingClientRect().left + 15) + "px").style("top", (event.pageY - chartContainer.getBoundingClientRect().top) + "px"); }).on("mouseleave", () => tooltip.style("opacity", 0));
        const link = svg.append('g').attr('fill', 'none').attr('stroke-opacity', 0.5).selectAll('g').data(links).join('g').style('mix-blend-mode', 'multiply');
        link.append('path').attr('d', sankeyLinkHorizontal()).attr('stroke', (d: any) => getCategoryColor(d.source.name.replace(/ \(.*\)$/, ''))).attr('stroke-width', (d: any) => Math.max(1, d.width));
        svg.append('g').style('font', '12px sans-serif').selectAll('text').data(nodes).join('text').attr('x', (d: any) => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6).attr('y', (d: any) => (d.y1 + d.y0) / 2).attr('dy', '0.35em').attr('text-anchor', (d: any) => d.x0 < width / 2 ? 'start' : 'end').text((d: any) => d.name).append('tspan').attr('fill-opacity', 0.7).text((d: any) => ` ${formatCurrency(d.value)}`);
    };

    if (uiState.activeTab === 'stats') {
        renderPieChart('stats-pie-chart');
        renderBarChart('stats-bar-chart');
    } else if (uiState.activeTab === 'flow') {
        renderSankeyChart('flow-sankey-chart');
    }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initializeState();
    renderApp();
});
