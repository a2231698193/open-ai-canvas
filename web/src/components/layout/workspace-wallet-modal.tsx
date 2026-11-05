import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Skeleton } from "antd";
import { ArrowRight, ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, Crown, HardDrive, History, RefreshCw, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { formatMembershipPrice, useMembershipPlans, type MembershipPlansData } from "@/components/membership/membership-plan-cards";
import { WalletTopupPanel, type TopupCategory } from "@/components/layout/workspace-wallet-topup";
import { CreditStorePanel } from "@/components/payment/credit-store-panel";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { currentLocale } from "@/i18n";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter } from "@/lib/account-storage-usage";
import { normalizeCreditStoreAmount } from "@/lib/credit-store";
import { generationErrorMessage } from "@/lib/generation-error";
import { estimatePaymentCharge, paymentOptionsFromProviders, type PaymentOption } from "@/lib/payment-options";
import { getPaymentSettings, listPaymentProviders, listTopupProducts, type CreditStorePolicy, type PaymentOrder, type PaymentProvider, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import { listMyStorageGrants } from "@/services/api/storage-grants";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { cn } from "@/lib/utils";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import "./workspace-wallet-modal.css";

type WalletModalTab = "topup" | "redeem" | "history";

const storageGrantsQueryKey = ["account-storage-grants"] as const;

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const loggedIn = useUserStore((state) => Boolean(state.user));
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [openDetail, setOpenDetail] = useState<WorkspaceWalletOpenDetail>({});

    // 积分关闭时仍要能打开充值页购买存储空间，只是隐藏积分余额、兑换和积分记录。
    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        setOpenDetail(detail);
        setOpen(true);
    };

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            applyOpen((raw as CustomEvent<WorkspaceWalletOpenDetail>).detail || {});
        };
        window.addEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (pathname !== "/wallet") return;
        const params = new URLSearchParams(search);
        openWorkspaceWallet({
            paymentOrderId: params.get("paymentOrder") || undefined,
            paymentInvalid: params.get("payment") === "invalid",
        });
        navigate("/", { replace: true });
    }, [navigate, pathname, search]);

    if (!loggedIn) return null;
    return (
        <WorkspaceWalletModal
            open={open}
            creditsEnabled={creditsEnabled}
            initialTab={openDetail.tab}
            initialCategory={openDetail.category}
            pendingPaymentOrderId={openDetail.paymentOrderId}
            paymentInvalid={openDetail.paymentInvalid}
            onClose={() => {
                setOpen(false);
                setOpenDetail({});
            }}
        />
    );
}

export function WorkspaceWalletModal({
    open,
    onClose,
    creditsEnabled = true,
    initialTab,
    initialCategory,
    pendingPaymentOrderId,
    paymentInvalid,
}: {
    open: boolean;
    onClose: () => void;
    creditsEnabled?: boolean;
    initialTab?: WalletModalTab;
    initialCategory?: TopupCategory;
    pendingPaymentOrderId?: string;
    paymentInvalid?: boolean;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const redeemPurchaseUrl = useAppearanceStore((state) => state.appearance.redeemPurchaseUrl);
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [focusKind, setFocusKind] = useState<TopupProductKind | undefined>();
    const [focusToken, setFocusToken] = useState(0);
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [creditStore, setCreditStore] = useState<CreditStorePolicy | null>(null);
    const [creditAmount, setCreditAmount] = useState(500);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
    const [usdCnyRate, setUsdCnyRate] = useState("");
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [selectedOptionKey, setSelectedOptionKey] = useState("");
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const requestSequence = useRef(0);
    const storageQuery = useAccountFileStorageUsage(open);
    const grantsQuery = useQuery({ queryKey: storageGrantsQueryKey, queryFn: listMyStorageGrants, enabled: open });
    const storageMeter = accountStorageMeter(storageQuery.data);
    const { data: membershipPlans } = useMembershipPlans(open);
    const membershipPlanList = membershipPlans?.plans;
    const minMembershipPriceFen = useMemo(() => {
        const prices = (membershipPlanList || []).map((plan) => plan.monthPriceFen).filter((price) => price > 0);
        return prices.length ? Math.min(...prices) : 0;
    }, [membershipPlanList]);

    const storageProducts = useMemo(() => products.filter((item) => item.kind === "storage"), [products]);
    const selectedProduct = useMemo(() => storageProducts.find((item) => item.id === selectedProductId), [storageProducts, selectedProductId]);
    const selectedProvider = useMemo(() => providers.find((item) => item.id === selectedProviderId), [providers, selectedProviderId]);
    const selectedOption = useMemo(() => paymentOptions.find((item) => item.key === selectedOptionKey), [paymentOptions, selectedOptionKey]);
    const activeTab: WalletModalTab = creditsEnabled ? tab : "topup";

    const reloadWallet = async (targetPage = page) => {
        if (!creditsEnabled) return;
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, "all");
            if (sequence === requestSequence.current) setWallet(result);
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(error instanceof Error ? error.message : t("account.wallet.loadFailed"));
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab || "topup");
        setFocusKind(initialCategory && initialCategory !== "all" ? initialCategory : undefined);
        setPage(1);
        void reloadWallet(1);
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders(), getPaymentSettings()])
            .then(([productResult, providerResult, settingsResult]) => {
                // 积分改由积分超市按数量购买，固定积分商品不再展示；存储套餐保持原样。
                const enabledProducts = productResult.products.filter((item) => item.enabled && item.kind === "storage");
                const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                const options = paymentOptionsFromProviders(usableProviders);
                setProducts(enabledProducts);
                setCreditStore(productResult.creditStore);
                setCreditAmount((current) => normalizeCreditStoreAmount(productResult.creditStore, current));
                setProviders(usableProviders);
                setPaymentOptions(options);
                setUsdCnyRate(settingsResult.settings.usdCnyRate || "");
                // 从容量入口进入时优先选中存储空间套餐。
                const preferred = enabledProducts.filter((item) => !initialCategory || initialCategory === "all" || item.kind === initialCategory);
                setSelectedProductId((current) =>
                    current && enabledProducts.some((item) => item.id === current) && !initialCategory ? current : preferred.find((item) => item.canPurchase)?.id || enabledProducts.find((item) => item.canPurchase)?.id || "",
                );
                setSelectedProviderId((current) => current || usableProviders[0]?.id || "");
                setSelectedOptionKey((current) => (current && options.some((item) => item.key === current) ? current : options[0]?.key || ""));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("account.wallet.configLoadFailed")))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error(t("account.wallet.paymentInvalid"));
    }, [open, paymentInvalid]);

    const announceWalletUpdated = async () => {
        setPage(1);
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    const announceGranted = async (order: PaymentOrder) => {
        if (order.productKind === "storage") {
            await Promise.all([queryClient.invalidateQueries({ queryKey: accountFileStorageUsageQueryKey }), queryClient.invalidateQueries({ queryKey: storageGrantsQueryKey })]);
            return;
        }
        await announceWalletUpdated();
    };

    const payment = usePaymentOrderFlow({ onGranted: announceGranted });

    useEffect(() => {
        payment.resetIdempotency();
    }, [creditAmount, selectedProductId, selectedProviderId, selectedOptionKey]);

    // 换了套餐后，当前支付入口可能因币种无法换算而不可用，改选第一个可用入口。
    useEffect(() => {
        if (!selectedProduct || !paymentOptions.length) return;
        const payable = (option: PaymentOption) => Boolean(estimatePaymentCharge(selectedProduct.amountFen, selectedProduct.currency, option.settlementCurrency, usdCnyRate));
        if (selectedOption && payable(selectedOption)) return;
        const next = paymentOptions.find(payable);
        if (next) setSelectedOptionKey(next.key);
    }, [selectedProduct, paymentOptions, selectedOption, usdCnyRate]);

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        void payment.showOrder(pendingPaymentOrderId);
    }, [open, pendingPaymentOrderId]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error(t("account.wallet.redeemCodeInvalid"));
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success(t("account.wallet.redeemSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.wallet.redeemFailed"));
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedOption) {
            message.error(t("account.wallet.selectRequired"));
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error(t("account.wallet.productUnavailable"));
            return;
        }
        await payment.start(selectedProduct.id, selectedOption.providerId, selectedOption.method);
    };

    const startCreditPayment = async () => {
        if (!creditStore || !selectedProvider) {
            message.error(t("account.wallet.selectRequired"));
            return;
        }
        // 积分超市按渠道展示；渠道内声明了多种支付方式时取该渠道的第一个入口（含方式的渠道只有一个按钮场景除外）。
        const option = paymentOptions.find((item) => item.providerId === selectedProvider.id);
        await payment.startCredit(normalizeCreditStoreAmount(creditStore, creditAmount), selectedProvider.id, option?.method);
    };

    // 定位到存储套餐：滚动到分组，并在当前选中项不属于该类时改选第一个可买套餐。
    const focusProducts = (kind: "storage") => {
        setTab("topup");
        setFocusKind(kind);
        setFocusToken((value) => value + 1);
        if (selectedProduct?.kind === kind) return;
        const next = products.find((item) => item.kind === kind && item.canPurchase);
        if (next) setSelectedProductId(next.id);
    };

    const purchasedAvailable = wallet?.account.availableMicrocredits ?? 0;
    const membershipAvailable = wallet?.membershipPoolValid ? (wallet.account.membershipMicrocredits ?? 0) : 0;
    const available = purchasedAvailable + membershipAvailable;
    const totalPages = Math.max(1, Math.ceil((wallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(920px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker">
                                <Coins />
                                {creditsEnabled ? t("nav.tools.wallet") : t("account.wallet.topupCenter")}
                            </span>
                            <h2>{creditsEnabled ? t("account.wallet.title") : t("account.wallet.titleStorage")}</h2>
                            <p>{creditsEnabled ? t("account.wallet.description") : t("account.wallet.descriptionStorage")}</p>
                        </div>
                        <div className="workspace-wallet-stats">
                            {creditsEnabled ? (
                                <div className="workspace-wallet-balance">
                                    <span>{t("shell.account.availableCredits")}</span>
                                    <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                                    {wallet?.membership ? (
                                        <span className="workspace-wallet-balance-split">{t("account.wallet.balanceSplit", { membership: formatCredits(membershipAvailable, 6), purchased: formatCredits(purchasedAvailable, 6) })}</span>
                                    ) : null}
                                    <small>{t("account.wallet.reserved", { amount: wallet ? formatCredits(wallet.account.reservedMicrocredits, 6) : "--" })}</small>
                                </div>
                            ) : null}
                            <button type="button" className="workspace-wallet-balance is-storage" aria-label={t("account.wallet.viewStorage")} onClick={() => focusProducts("storage")}>
                                <span>
                                    <HardDrive className="inline size-3 align-[-1px]" aria-hidden="true" /> {t("account.wallet.storage")}
                                </span>
                                <strong>{storageQuery.data ? `${storageMeter.usedLabel} / ${storageMeter.totalLabel}` : "--"}</strong>
                                <span className="wallet-topup-storage-track" aria-hidden="true">
                                    <span style={{ width: `${storageMeter.percent}%` }} />
                                </span>
                                <small>
                                    {storageMeter.state === "read_only"
                                        ? t("account.wallet.storageReadOnly")
                                        : storageMeter.state === "grace"
                                          ? t("account.wallet.storageGrace")
                                          : storageMeter.purchasedLabel
                                            ? t("account.wallet.storagePurchased", { size: storageMeter.purchasedLabel })
                                            : t("account.layout.storage.remaining", { size: storageMeter.remainingLabel })}
                                </small>
                            </button>
                        </div>
                    </header>

                    {creditsEnabled && wallet ? (
                        <WalletMembershipCard
                            wallet={wallet}
                            membershipPlans={membershipPlans}
                            minMembershipPriceFen={minMembershipPriceFen}
                            totalAvailable={available}
                            purchasedAvailable={purchasedAvailable}
                            membershipAvailable={membershipAvailable}
                            onOpenMembership={() => {
                                onClose();
                                navigate("/membership");
                            }}
                        />
                    ) : null}

                    {creditsEnabled ? (
                        <div className="workspace-wallet-tabs" role="tablist" aria-label={t("nav.tools.wallet")}>
                            <button type="button" role="tab" aria-selected={activeTab === "topup"} onClick={() => setTab("topup")}>
                                <WalletCards />
                                {t("account.wallet.tabTopup")}
                            </button>
                            <button type="button" role="tab" aria-selected={activeTab === "redeem"} onClick={() => setTab("redeem")}>
                                <TicketCheck />
                                {t("account.wallet.tabRedeem")}
                            </button>
                            <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setTab("history")}>
                                <History />
                                {t("account.wallet.tabHistory")}
                            </button>
                        </div>
                    ) : null}

                    {activeTab === "topup" ? (
                        <div className="workspace-wallet-topup-tab">
                            {creditsEnabled && minMembershipPriceFen > 0 ? (
                                <button
                                    type="button"
                                    className="workspace-wallet-membership-promo"
                                    onClick={() => {
                                        onClose();
                                        navigate("/membership");
                                    }}
                                >
                                    <Crown />
                                    <div>
                                        <strong>{t("account.wallet.membershipPromoTitle", { price: formatMembershipPrice(minMembershipPriceFen) })}</strong>
                                        <span>{t("account.wallet.membershipPromoHint")}</span>
                                    </div>
                                    <ArrowRight />
                                </button>
                            ) : null}
                            {creditsEnabled ? (
                                <div className="workspace-wallet-credit-store">
                                    <CreditStorePanel
                                        loading={paymentsLoading}
                                        policy={creditStore}
                                        credits={creditAmount}
                                        onCreditsChange={setCreditAmount}
                                        providers={providers}
                                        selectedProviderId={selectedProviderId}
                                        onSelectProvider={setSelectedProviderId}
                                        creating={payment.creating}
                                        onPay={() => void startCreditPayment()}
                                    />
                                </div>
                            ) : null}
                            <WalletTopupPanel
                                loading={paymentsLoading}
                                products={storageProducts}
                                paymentOptions={paymentOptions}
                                usdCnyRate={usdCnyRate}
                                focusKind={focusKind}
                                focusToken={focusToken}
                                selectedProduct={selectedProduct}
                                onSelectProduct={setSelectedProductId}
                                selectedOptionKey={selectedOptionKey}
                                onSelectOption={setSelectedOptionKey}
                                creating={payment.creating}
                                onPay={() => void startPayment()}
                                storageUsage={storageQuery.data}
                                storageGrants={grantsQuery.data?.grants || []}
                                onCleanAssets={() => {
                                    onClose();
                                    navigate("/assets");
                                }}
                                emptyState={null}
                            />
                        </div>
                    ) : activeTab === "redeem" ? (
                        <div className="workspace-wallet-content is-redeem">
                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading">
                                    <div>
                                        <h3>{t("account.wallet.redeemTitle")}</h3>
                                        <p>
                                            {t("account.wallet.redeemDescription")}
                                            {redeemPurchaseUrl ? (
                                                <a className="workspace-wallet-redeem-link" href={redeemPurchaseUrl} target="_blank" rel="noopener noreferrer">
                                                    {t("account.wallet.redeemGet")}
                                                </a>
                                            ) : null}
                                        </p>
                                    </div>
                                    <TicketCheck />
                                </div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder={t("account.wallet.redeemPlaceholder")} onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>
                                        {t("account.wallet.redeemSubmit")}
                                    </Button>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar">
                                <div>
                                    <h3>{t("account.wallet.tabHistory")}</h3>
                                    <p>{t("account.wallet.historyDescription")}</p>
                                </div>
                                <Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>
                                    {t("common.refresh")}
                                </Button>
                            </div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? (
                                    <div className="workspace-wallet-inline-state is-error">
                                        <CircleAlert />
                                        <div>
                                            <strong>{t("account.wallet.historyLoadFailed")}</strong>
                                            <span>{walletError}</span>
                                        </div>
                                        <Button onClick={() => void reloadWallet(page)}>{t("common.retry")}</Button>
                                    </div>
                                ) : walletLoading && !wallet ? (
                                    <Skeleton active paragraph={{ rows: 6 }} />
                                ) : wallet?.entries.length ? (
                                    <div className="workspace-wallet-ledger">
                                        {wallet.entries.map((entry) => (
                                            <WalletLedgerRow key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-wallet-empty">
                                        <History />
                                        <strong>{t("account.wallet.historyEmpty")}</strong>
                                        <span>{t("account.wallet.historyEmptyHint")}</span>
                                    </div>
                                )}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>{t("account.wallet.pageOf", { page, total: totalPages })}</span>
                                <button
                                    type="button"
                                    disabled={page <= 1 || walletLoading}
                                    aria-label={t("account.layout.pagination.prev")}
                                    onClick={() => {
                                        const next = page - 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronLeft />
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages || walletLoading}
                                    aria-label={t("account.layout.pagination.next")}
                                    onClick={() => {
                                        const next = page + 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronRight />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            {payment.dialog}
        </>
    );
}

function WalletMembershipCard({
    wallet,
    membershipPlans,
    minMembershipPriceFen,
    totalAvailable,
    purchasedAvailable,
    membershipAvailable,
    onOpenMembership,
}: {
    wallet: WalletSummary;
    membershipPlans?: MembershipPlansData | null;
    minMembershipPriceFen: number;
    totalAvailable: number;
    purchasedAvailable: number;
    membershipAvailable: number;
    onOpenMembership: () => void;
}) {
    const { membership, membershipPlanName, account, membershipPoolValid } = wallet;
    const currentPlan = membershipPlans?.plans.find((plan) => plan.id === membership?.planId);
    if (!membership) {
        return (
            <div className="workspace-wallet-membership" role="region" aria-label="会员">
                <Crown className="size-4" />
                <div className="min-w-0 flex-1">
                    <strong>会员积分</strong>
                    <span>{minMembershipPriceFen > 0 ? `${formatMembershipPrice(minMembershipPriceFen)}/月起开通会员，` : "开通会员"}每月到账专属积分，生成扣费优先抵扣。</span>
                </div>
                <button type="button" onClick={onOpenMembership}>
                    开通会员
                </button>
            </div>
        );
    }
    const expiry = membershipPoolValid && account.membershipExpiresAt ? new Date(account.membershipExpiresAt).toLocaleDateString("zh-CN") : "";
    const renewalPriceFen = currentPlan && currentPlan.monthPriceFen > 0 ? currentPlan.monthPriceFen : minMembershipPriceFen;
    return (
        <div className="workspace-wallet-membership is-active" role="region" aria-label="当前会员">
            <Crown className="size-4" />
            <div className="min-w-0 flex-1">
                <strong>
                    {membershipPlanName || "会员"}
                    <span> {expiry ? `${expiry} 前有效` : membershipPoolValid ? "" : " 已过期"}</span>
                </strong>
                <span>
                    会员 {formatCredits(membershipAvailable, 6)} · 充值 {formatCredits(purchasedAvailable, 6)}
                    {renewalPriceFen > 0 ? ` · 续费 ${formatMembershipPrice(renewalPriceFen)}/月起` : " · 生成优先扣会员，到期清零"}
                </span>
            </div>
            <div className="workspace-wallet-membership-figure">
                <strong>{formatCredits(totalAvailable, 6)}</strong>
                <span>合计可用</span>
            </div>
            <button type="button" onClick={onOpenMembership}>
                续费会员
            </button>
        </div>
    );
}

function WalletLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
    const { t } = useTranslation();
    const positive = entry.amountMicrocredits > 0;
    const note = entry.note ? generationErrorMessage(entry.note) : "";
    const title =
        entry.type === "consume"
            ? t("account.wallet.ledger.consume")
            : entry.type === "refund"
              ? t("account.wallet.ledger.refund")
              : entry.type === "payment_topup"
                ? t("account.wallet.ledger.paymentTopup")
                : entry.type === "redeem"
                  ? t("account.wallet.ledger.redeem")
                  : entry.type === "referral_commission"
                    ? t("account.wallet.ledger.referral")
                    : note || t("account.wallet.ledger.adjust");
    return (
        <article className="workspace-wallet-ledger-row">
            <span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")}>{positive ? <Coins /> : <CreditCard />}</span>
            <div>
                <strong>{title}</strong>
                <span>{[entry.scene, entry.model, note].filter(Boolean).join(" · ") || t("account.wallet.ledger.change")}</span>
            </div>
            <time>{new Date(entry.createdAt).toLocaleString(currentLocale(), { hour12: false })}</time>
            <b className={positive ? "is-income" : "is-consume"}>
                {positive ? "+" : ""}
                {formatCredits(entry.amountMicrocredits, 6)}
            </b>
        </article>
    );
}
