import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  changeLeaderAccess,
  closeLeaderRoomAsOwner,
  deleteLeaderAndData,
  getOwnerAdminDashboard,
  getOwnerInviteStats,
  getOwnerLeaderDetails,
  isPlatformOwner,
  logoutLeader,
  markOwnerNotificationsRead,
  prepareLeaderDeletion,
  publishSafePackCatalogueAsOwner,
  subscribeAuthUser,
  subscribeOwnerNotifications,
  type LeaderDeletionPreview,
  type OwnerDashboard,
  type OwnerInviteStat,
  type OwnerLeaderDetails,
  type OwnerRegistrationNotification,
} from "./repositories/firebaseRepository";
import type { UserStatus } from "./types";
import { OwnerProducts } from "./OwnerProducts";
import {
  AppIcon,
  type AppIconName,
  Button,
  Surface,
} from "./components/DesignSystem";

type Tab =
  | "overview"
  | "users"
  | "invites"
  | "rooms"
  | "modes"
  | "activity"
  | "library"
  | "feedback";
type Range = "today" | "7d" | "30d" | "custom";
type Field =
  | "registrations"
  | "roomCreated"
  | "starts"
  | "roomCompleted"
  | "joins"
  | "completions";
const timezone = "Asia/Almaty";
const status: Record<UserStatus, string> = {
  pending: "Ожидает",
  active: "Активен",
  paused: "Заблокирован",
  revoked: "Отозван",
};
const modeName: Record<string, string> = {
  diagnostic: "Проверь себя",
  quiz: "Библейская викторина",
  wheel: "Колесо фортуны",
};
const roomState: Record<string, string> = {
  active: "Активна сейчас",
  inactive: "Неактивна / незавершена",
  completed: "Завершена",
  unknown: "Статус не определён",
};
const eventName: Record<string, string> = {
  registration: "Регистрация",
  room_created: "Создана комната",
  room_started: "Запущена комната",
  room_closed: "Завершена комната",
  access_changed: "Изменён доступ",
};
const navIcon: Record<Tab, AppIconName> = {
  overview: "dashboard",
  users: "profile",
  invites: "quiz",
  rooms: "room",
  modes: "diagnostic",
  activity: "history",
  library: "quiz",
  feedback: "flag",
};
const publicAsset = (fileName: string) =>
  `${import.meta.env.BASE_URL}assets/${fileName}`;
const storedOwnerTheme = (): "dark" | "light" => {
  try {
    return localStorage.getItem("youth-vibe-owner-theme") === "light"
      ? "light"
      : "dark";
  } catch {
    return document.documentElement.dataset.ownerTheme === "light"
      ? "light"
      : "dark";
  }
};
const colour: Record<Field, string> = {
  registrations: "chart-registrations",
  roomCreated: "chart-roomCreated",
  starts: "chart-starts",
  roomCompleted: "chart-roomCompleted",
  joins: "chart-joins",
  completions: "chart-completions",
};
const date = (value?: number | null) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
      }).format(new Date(value))
    : "Нет данных";
const count = (value?: number | null) =>
  value == null ? "—" : new Intl.NumberFormat("ru-RU").format(value);
const inputDate = (value: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const dayStart = (value: string) => Date.parse(`${value}T00:00:00+05:00`);
const Card = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => <Surface className={`owner-card ${className}`}>{children}</Surface>;
const ButtonX = ({
  children,
  secondary,
  danger,
  ...props
}: ComponentProps<typeof Button>) => (
  <Button
    className="owner-button"
    secondary={secondary}
    danger={danger}
    {...props}
  >
    {children}
  </Button>
);

function Chart({
  rows,
  fields,
  title,
  legend,
}: {
  rows: OwnerDashboard["charts"]["daily"];
  fields: Field[];
  title: string;
  legend: string[];
}) {
  const max = Math.max(
    1,
    ...rows.flatMap((row) => fields.map((field) => Number(row[field]) || 0)),
  );
  return (
    <Card className="owner-graph">
      <h2>{title}</h2>
      {rows.length ? (
        <>
          <div className="owner-chart">
            {rows.slice(-20).map((row) => (
              <div
                className="owner-chart-day"
                key={row.day}
                title={`${row.day}: ${fields.map((field) => `${field} ${row[field] ?? "нет данных"}`).join(", ")}`}
              >
                <div className="owner-chart-bars">
                  {fields.map((field) => (
                    <i
                      className={colour[field]}
                      key={field}
                      style={{
                        height: `${Math.max(3, (Number(row[field]) / max) * 100)}%`,
                      }}
                    />
                  ))}
                </div>
                <small>{row.day.slice(5)}</small>
              </div>
            ))}
          </div>
          <small className="owner-chart-key">
            {legend.map((item, index) => (
              <span key={item}>
                <i className={colour[fields[index]]} /> {item}
              </span>
            ))}
          </small>
        </>
      ) : (
        <p className="owner-empty-copy">
          За период нет зафиксированных событий.
        </p>
      )}
    </Card>
  );
}

function ModeLaunchChart({
  rows,
}: {
  rows: Array<{ day: string; value: number }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Card className="owner-graph">
      <h2>Запуски по дням</h2>
      {rows.length ? (
        <div className="owner-chart">
          {rows.slice(-20).map((row) => (
            <div
              className="owner-chart-day"
              key={row.day}
              title={`${row.day}: ${row.value} запусков`}
            >
              <div className="owner-chart-bars">
                <i
                  className="chart-starts"
                  style={{ height: `${Math.max(3, (row.value / max) * 100)}%` }}
                />
              </div>
              <small>{row.day.slice(5)}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="owner-empty-copy">
          В выбранном периоде запусков не было.
        </p>
      )}
    </Card>
  );
}

function InvitationCodes({
  invites,
  error,
  onRefresh,
}: {
  invites: OwnerInviteStat[] | null;
  error: string;
  onRefresh: () => void;
}) {
  return (
    <Card className="owner-invites">
      <div className="owner-invites-head">
        <div>
          <p className="eyebrow">ДОСТУП ПО ПРИГЛАШЕНИЮ</p>
          <h2>Коды приглашения</h2>
          <p>
            Использование берётся из защищённого журнала кодов и не меняется при
            удалении аккаунта.
          </p>
        </div>
        <ButtonX secondary onClick={onRefresh}>
          Обновить коды
        </ButtonX>
      </div>
      {error && (
        <p className="owner-error" role="alert">
          {error}
        </p>
      )}
      <div className="owner-invites-scroll">
        <table className="owner-table">
          <thead>
            <tr>
              <th>Код</th>
              <th>Лимит</th>
              <th>Использовано</th>
              <th>Осталось</th>
              <th>Статус</th>
              <th>Срок</th>
            </tr>
          </thead>
          <tbody>
            {invites === null && (
              <tr>
                <td colSpan={6}>Загружаем коды…</td>
              </tr>
            )}
            {invites?.map((invite) => (
              <tr key={invite.code}>
                <td>
                  <b>{invite.code}</b>
                  <button
                    className="owner-inline-copy"
                    type="button"
                    onClick={() =>
                      void navigator.clipboard?.writeText(invite.code)
                    }
                  >
                    Скопировать
                  </button>
                </td>
                <td>
                  {invite.limit === null ? "Без ограничений" : invite.limit}
                </td>
                <td>{invite.used === null ? "Нет данных" : invite.used}</td>
                <td>
                  {invite.remaining === null
                    ? invite.limit === null
                      ? "Без ограничений"
                      : "Нет данных"
                    : invite.remaining}
                </td>
                <td>
                  <span
                    className={`owner-status ${invite.status === "active" ? "active" : invite.status === "expired" ? "pending" : "revoked"}`}
                  >
                    {invite.status === "active"
                      ? "Доступен"
                      : invite.status === "expired"
                        ? "Истёк"
                        : invite.status === "exhausted"
                          ? "Лимит исчерпан"
                          : "Отключён"}
                  </span>
                </td>
                <td>
                  {invite.expiresAt ? date(invite.expiresAt) : "Без срока"}
                </td>
              </tr>
            ))}
            {invites?.length === 0 && (
              <tr>
                <td colSpan={6}>Коды приглашения не найдены.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LeaderDetailsScreen({ user, details, error, roomMode, roomStatus, saving, onBack, onRoomMode, onRoomStatus, onLoadMore, onOpenRooms, onAccess, onDelete }: { user: OwnerDashboard['users'][number]; details: OwnerLeaderDetails | null; error: string; roomMode: string; roomStatus: string; saving: boolean; onBack: () => void; onRoomMode: (value: string) => void; onRoomStatus: (value: string) => void; onLoadMore: () => void; onOpenRooms: () => void; onAccess: (next: UserStatus) => void; onDelete: () => void }) {
  const profile = details?.profile
  return <>
    <header className="owner-header owner-detail-header"><div><p className="eyebrow">АККАУНТЫ · КАРТОЧКА ВЕДУЩЕГО</p><h1>{profile?.fullName || user.fullName || 'Ведущий'}</h1><p className="owner-header-subtitle">Данные и комнаты выбранного ведущего. Личные ответы участников не раскрываются.</p></div><ButtonX secondary onClick={onBack}>← Назад к аккаунтам</ButtonX></header>
    <Card className="leader-detail leader-detail-screen">
      {error && <p className="owner-error">{error}</p>}
      {!details && !error && <p>Загружаем поля регистрации и комнаты…</p>}
      {details && <><div className="leader-detail-grid"><div><dt>Email</dt><dd>{profile?.email || 'Не указано'}</dd></div><div><dt>Телефон</dt><dd>{profile?.phone || 'Не указано'}</dd></div><div><dt>Молодёжная группа / организация</dt><dd>{details.workspace?.name || 'Не указано'}</dd></div><div><dt>Город</dt><dd>{details.workspace?.city || 'Не указано'}</dd></div><div><dt>Дата регистрации</dt><dd>{date(profile?.createdAt)}</dd></div><div><dt>Роль</dt><dd>Ведущий</dd></div><div><dt>Доступ</dt><dd>{status[profile!.status]}</dd></div><div><dt>Способ доступа</dt><dd>{profile?.accessSource === 'invite' ? 'Приглашение' : profile?.accessSource === 'approval' ? 'Одобрение администратора' : profile?.accessSource || 'Не указано'}</dd></div></div><div className="leader-room-filters"><select value={roomMode} onChange={event => onRoomMode(event.target.value)}><option value="">Все режимы</option>{Object.entries(modeName).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select value={roomStatus} onChange={event => onRoomStatus(event.target.value)}><option value="">Все статусы</option>{Object.entries(roomState).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><p className="eyebrow">КОМНАТЫ · {details.totalRooms}</p><div className="leader-room-list">{details.rooms.map(room => <button type="button" key={room.roomId} onClick={onOpenRooms}><b>{room.roomTitle}</b><small>{modeName[room.mode]} · {date(room.createdAt)} · {room.participantCount} участников · {room.endedAt ? `завершена ${date(room.endedAt)}` : roomState[room.operationalStatus]}</small></button>)}{!details.rooms.length && <p>Комнат по выбранным фильтрам нет.</p>}</div>{details.nextOffset !== null && <ButtonX secondary onClick={onLoadMore}>Загрузить ещё</ButtonX>}<ButtonX secondary onClick={onOpenRooms}>Открыть комнаты в списке</ButtonX></>}
      <div className="owner-actions"><ButtonX disabled={saving || user.status === 'active'} onClick={() => onAccess('active')}>Восстановить</ButtonX><ButtonX secondary disabled={saving || user.status === 'paused'} onClick={() => onAccess('paused')}>Заблокировать</ButtonX><ButtonX danger disabled={saving || user.status === 'revoked'} onClick={() => onAccess('revoked')}>Отозвать</ButtonX><ButtonX danger disabled={saving} onClick={onDelete}>Удалить ведущего и его данные</ButtonX></div>
    </Card>
  </>
}

export function OwnerAdmin() {
  const [auth, setAuth] = useState<"checking" | "owner" | "denied" | "error">(
    "checking",
  );
  const [data, setData] = useState<OwnerDashboard | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("30d");
  const [custom, setCustom] = useState({
    from: inputDate(Date.now() - 29 * 86400000),
    to: inputDate(Date.now()),
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [hostFilter, setHostFilter] = useState("");
  const [roomStatus, setRoomStatus] = useState("");
  const [roomMetric, setRoomMetric] = useState("");
  const [userMetric, setUserMetric] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedMode, setSelectedMode] = useState("");
  const [confirm, setConfirm] = useState<{
    uid: string;
    next: UserStatus;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(storedOwnerTheme);
  const [ownerUid, setOwnerUid] = useState("");
  const [notifications, setNotifications] = useState<
    OwnerRegistrationNotification[]
  >([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toastIds, setToastIds] = useState<string[]>([]);
  const [inviteStats, setInviteStats] = useState<OwnerInviteStat[] | null>(
    null,
  );
  const [inviteStatsError, setInviteStatsError] = useState("");
  const [leaderDetails, setLeaderDetails] = useState<OwnerLeaderDetails | null>(
    null,
  );
  const [leaderDetailsError, setLeaderDetailsError] = useState("");
  const [leaderRoomMode, setLeaderRoomMode] = useState("");
  const [leaderRoomStatus, setLeaderRoomStatus] = useState("");
  const [deletionPreview, setDeletionPreview] =
    useState<LeaderDeletionPreview | null>(null);
  const [deletionError, setDeletionError] = useState("");
  const [deletionProgress, setDeletionProgress] = useState("");
  const seenNotificationIds = useRef(new Set<string>());
  const period = useMemo(() => {
    const to = Date.now();
    if (range === "today") return { from: dayStart(inputDate(to)), to };
    if (range === "7d") return { from: to - 6 * 86400000, to };
    if (range === "custom")
      return {
        from: dayStart(custom.from),
        to: dayStart(custom.to) + 86399999,
      };
    return { from: to - 29 * 86400000, to };
  }, [range, custom]);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await getOwnerAdminDashboard(period, {
          search: appliedSearch,
          mode: modeFilter,
          hostUid: hostFilter,
          roomStatus,
          roomMetric,
          userMetric,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось загрузить административные данные.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    const stop = subscribeAuthUser((user) => {
      if (!user || user.isAnonymous) {
        if (active) {
          setOwnerUid("");
          setAuth("denied");
        }
        return;
      }
      void isPlatformOwner()
        .then((owner) => {
          if (active) {
            setOwnerUid(owner ? user.uid : "");
            setAuth(owner ? "owner" : "denied");
          }
        })
        .catch((cause) => {
          if (active) {
            setOwnerUid("");
            setAuth("error");
            setError(
              cause instanceof Error
                ? cause.message
                : "Не удалось проверить роль владельца.",
            );
          }
        });
    });
    return () => {
      active = false;
      stop();
    };
  }, []);
  useEffect(() => {
    if (auth === "owner") void load();
  }, [
    auth,
    period.from,
    period.to,
    appliedSearch,
    modeFilter,
    hostFilter,
    roomStatus,
    roomMetric,
    userMetric,
  ]);
  const loadInviteStats = async () => {
    setInviteStatsError("");
    try {
      setInviteStats(await getOwnerInviteStats());
    } catch (cause) {
      setInviteStatsError(
        cause instanceof Error
          ? cause.message
          : "Не удалось загрузить коды приглашения.",
      );
    }
  };
  useEffect(() => {
    if (auth === "owner" && tab === "invites") void loadInviteStats();
  }, [auth, tab]);
  useEffect(() => {
    if (!selectedUserId || auth !== "owner") {
      setLeaderDetails(null);
      return;
    }
    let current = true;
    setLeaderDetailsError("");
    void getOwnerLeaderDetails(selectedUserId, {
      mode: leaderRoomMode,
      roomStatus: leaderRoomStatus,
    })
      .then((value) => {
        if (current) setLeaderDetails(value);
      })
      .catch((cause) => {
        if (current) {
          setLeaderDetails(null);
          setLeaderDetailsError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить карточку ведущего.",
          );
        }
      });
    return () => {
      current = false;
    };
  }, [auth, selectedUserId, leaderRoomMode, leaderRoomStatus]);
  useEffect(() => {
    document.documentElement.dataset.ownerTheme = theme;
    try {
      localStorage.setItem("youth-vibe-owner-theme", theme);
    } catch {}
    return () => {
      delete document.documentElement.dataset.ownerTheme;
    };
  }, [theme]);
  useEffect(() => {
    if (auth !== "owner" || !ownerUid) {
      setNotifications([]);
      setToastIds([]);
      seenNotificationIds.current.clear();
      return;
    }
    let firstSnapshot = true;
    const stop = subscribeOwnerNotifications(
      (items) => {
        const newIds = items
          .filter((item) => !seenNotificationIds.current.has(item.id))
          .map((item) => item.id);
        items.forEach((item) => seenNotificationIds.current.add(item.id));
        setNotifications(items);
        // Existing events remain unread in the list, but opening the console or
        // reconnecting never replays them as a stack of disruptive toasts.
        if (!firstSnapshot && newIds.length)
          setToastIds((previous) =>
            [...newIds, ...previous.filter((id) => !newIds.includes(id))].slice(
              0,
              3,
            ),
          );
        firstSnapshot = false;
      },
      () => undefined,
    );
    return stop;
  }, [auth, ownerUid]);
  useEffect(() => {
    if (!toastIds.length) return;
    const timer = window.setTimeout(
      () => setToastIds((previous) => previous.slice(0, -1)),
      8000,
    );
    return () => window.clearTimeout(timer);
  }, [toastIds]);
  const selectedUser =
    data?.users.find((user) => user.uid === selectedUserId) || null;
  // The dashboard can briefly be served by an earlier callable version while a
  // deploy propagates. Keep the operational console usable during that window.
  const modes = data?.modeAnalytics ?? [];
  const selectedModeData =
    modes.find((item) => item.mode === selectedMode) || null;
  const openUserList = (metric: string) => {
    setUserMetric(metric);
    setTab("users");
  };
  const unreadNotifications = notifications.filter(
    (item) => !item.readBy?.[ownerUid],
  );
  const notificationTitle = (item: OwnerRegistrationNotification) =>
    item.type === "registration_pending"
      ? "Новая заявка на доступ"
      : "Новый пользователь";
  const notificationDescription = (item: OwnerRegistrationNotification) =>
    `${item.fullName || item.email || "Пользователь"} ${item.type === "registration_pending" ? "зарегистрировался и ожидает одобрения" : "получил доступ по приглашению"}`;
  const markNotificationsRead = (ids: string[]) => {
    if (!ids.length || !ownerUid) return;
    setNotifications((previous) =>
      previous.map((item) =>
        ids.includes(item.id)
          ? { ...item, readBy: { ...item.readBy, [ownerUid]: Date.now() } }
          : item,
      ),
    );
    void markOwnerNotificationsRead(ids).catch(() => undefined);
  };
  const openNotificationProfile = (item: OwnerRegistrationNotification) => {
    markNotificationsRead([item.id]);
    setNotificationsOpen(false);
    setToastIds((previous) => previous.filter((id) => id !== item.id));
    setSearch(item.uid);
    setAppliedSearch(item.uid);
    setUserMetric("");
    setSelectedUserId(item.uid);
    setTab("users");
  };
  const openLeaderRooms = () => {
    if (!leaderDetails) return;
    setHostFilter(leaderDetails.profile.uid);
    setModeFilter(leaderRoomMode);
    setRoomStatus(leaderRoomStatus);
    setTab("rooms");
  };
  const openDeletionPreview = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setDeletionError("");
    setDeletionProgress("Проверяем связанные данные…");
    try {
      setDeletionPreview(await prepareLeaderDeletion(selectedUser.uid));
    } catch (cause) {
      setDeletionError(
        cause instanceof Error
          ? cause.message
          : "Не удалось подготовить удаление.",
      );
    } finally {
      setSaving(false);
      setDeletionProgress("");
    }
  };
  const deleteLeader = async () => {
    if (!deletionPreview) return;
    setSaving(true);
    setDeletionError("");
    setDeletionProgress("Отзываем доступ и удаляем связанные данные…");
    try {
      const result = await deleteLeaderAndData(deletionPreview.uid);
      setDeletionPreview(null);
      setSelectedUserId("");
      setLeaderDetails(null);
      setNotice(result.alreadyDeleted
        ? "Предыдущая операция уже завершила удаление. Список и аналитика обновлены."
        : "Ведущий и принадлежащие ему данные удалены. Аналитика пересчитана из оставшихся записей.");
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setDeletionError(!message || message === "INTERNAL"
        ? "Удаление не завершено. Ничего не удаляйте вручную: повторите попытку. Если ошибка повторится, обратитесь к владельцу платформы."
        : message);
    } finally {
      setSaving(false);
      setDeletionProgress("");
    }
  };
  const closeActiveLeaderRoom = async (roomId: string) => {
    if (!deletionPreview) return;
    setSaving(true);
    setDeletionError("");
    setDeletionProgress("Завершаем активную комнату…");
    try {
      await closeLeaderRoomAsOwner(deletionPreview.uid, roomId);
      setDeletionPreview(await prepareLeaderDeletion(deletionPreview.uid));
      setNotice("Комната завершена администратором. Теперь можно продолжить удаление.");
    } catch (cause) {
      setDeletionError(cause instanceof Error ? cause.message : "Не удалось завершить активную комнату.");
    } finally {
      setSaving(false);
      setDeletionProgress("");
    }
  };
  const updateTheme = (nextTheme: "dark" | "light") => {
    try {
      localStorage.setItem("youth-vibe-owner-theme", nextTheme);
    } catch {}
    setTheme(nextTheme);
  };
  const openRoomList = (metric: string, selectedModeValue = "") => {
    setRoomMetric(metric);
    setModeFilter(selectedModeValue);
    setRoomStatus(
      metric === "active" ? "active" : metric === "inactive" ? "inactive" : "",
    );
    setTab("rooms");
  };
  const changeAccess = async () => {
    if (!confirm || !selectedUser) return;
    setSaving(true);
    try {
      await changeLeaderAccess(confirm.uid, confirm.next, reason);
      setNotice(`Доступ «${selectedUser.fullName}» изменён.`);
      setConfirm(null);
      setReason("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось изменить доступ.",
      );
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    setSaving(true);
    try {
      const value = await publishSafePackCatalogueAsOwner();
      setNotice(`Безопасные версии ${value} наборов опубликованы.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось синхронизировать библиотеку.",
      );
    } finally {
      setSaving(false);
    }
  };
  if (auth === "checking")
    return (
      <main className="auth-page">
        <Card className="owner-auth-card">
          <p className="eyebrow">ВЛАДЕЛЕЦ ПЛАТФОРМЫ</p>
          <h1>Проверяем доступ…</h1>
        </Card>
      </main>
    );
  if (auth !== "owner")
    return (
      <main className="auth-page">
        <Card className="owner-auth-card">
          <p className="eyebrow">НЕТ ДОСТУПА</p>
          <h1>Панель владельца недоступна</h1>
          <p>{error || "Нужна серверная роль владельца платформы."}</p>
          <ButtonX
            onClick={() =>
              void logoutLeader().then(() =>
                window.location.assign(
                  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/login`,
                ),
              )
            }
          >
            Выйти
          </ButtonX>
        </Card>
      </main>
    );
  const tabs: Array<[Tab, string]> = [
    ["overview", "Обзор"],
    ["users", "Аккаунты"],
    ["invites", "Коды приглашения"],
    ["rooms", "Комнаты"],
    ["modes", "Режимы"],
    ["activity", "Журнал действий"],
    ["library", "Библиотека"],
    ["feedback", "Обратная связь"],
  ];
  const metricCard = (
    title: string,
    value: number | null,
    note: string,
    action?: () => void,
  ) => (
    <button type="button" className="owner-metric-button" onClick={action}>
      <Card>
        <small>{title}</small>
        <b>{count(value)}</b>
        <span>{note}</span>
      </Card>
    </button>
  );
  return (
    <main className="owner-shell" data-theme={theme}>
      <aside className="owner-sidebar">
        <div className="owner-brand">
          <img
            src={publicAsset("youth-vibe-logo-white.png")}
            alt="Молодёжный Вайб — создаём атмосферу вместе"
          />
          <small>рабочая панель владельца</small>
        </div>
        <nav aria-label="Разделы панели">
          {tabs.map(([id, name]) => (
            <button
              type="button"
              key={id}
              className={tab === id ? "selected" : ""}
              onClick={() => setTab(id)}
            >
              <AppIcon name={navIcon[id]} size={17} />
              {name}
            </button>
          ))}
        </nav>
        <div className="owner-sidebar-foot">
          <small>Часовой пояс отчёта</small>
          <b>{timezone}</b>
          <div
            className="owner-theme-toggle"
            role="group"
            aria-label="Тема административной панели"
          >
            <button
              type="button"
              className={theme === "light" ? "selected" : ""}
              aria-pressed={theme === "light"}
              onClick={() => updateTheme("light")}
            >
              <span aria-hidden="true">☼</span> Светлая
            </button>
            <button
              type="button"
              className={theme === "dark" ? "selected" : ""}
              aria-pressed={theme === "dark"}
              onClick={() => updateTheme("dark")}
            >
              <span aria-hidden="true">◐</span> Тёмная
            </button>
          </div>
          <ButtonX
            secondary
            onClick={() =>
              void logoutLeader().then(() =>
                window.location.assign(
                  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/login`,
                ),
              )
            }
          >
            Выйти
          </ButtonX>
        </div>
      </aside>
      <section className="owner-content">
        {error && (
          <p className="owner-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="owner-success" role="status">
            {notice}
          </p>
        )}
        <div className="owner-toolbar">
          <div className="owner-range">
            {(
              [
                ["today", "Сегодня"],
                ["7d", "7 дней"],
                ["30d", "30 дней"],
                ["custom", "Диапазон"],
              ] as Array<[Range, string]>
            ).map(([id, name]) => (
              <button
                type="button"
                key={id}
                className={range === id ? "selected" : ""}
                onClick={() => setRange(id)}
              >
                {name}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="owner-custom-range">
              <input
                type="date"
                value={custom.from}
                onChange={(event) =>
                  setCustom({ ...custom, from: event.target.value })
                }
              />
              <input
                type="date"
                value={custom.to}
                onChange={(event) =>
                  setCustom({ ...custom, to: event.target.value })
                }
              />
            </div>
          )}
          <div
            className="owner-theme-toggle owner-theme-toolbar"
            role="group"
            aria-label="Тема административной панели"
          >
            <button
              type="button"
              className={theme === "light" ? "selected" : ""}
              aria-pressed={theme === "light"}
              onClick={() => updateTheme("light")}
            >
              ☼ Светлая
            </button>
            <button
              type="button"
              className={theme === "dark" ? "selected" : ""}
              aria-pressed={theme === "dark"}
              onClick={() => updateTheme("dark")}
            >
              ◐ Тёмная
            </button>
          </div>
          <button
            type="button"
            className="owner-notification-trigger"
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <AppIcon name="bell" size={17} />
            Уведомления
            {unreadNotifications.length > 0 && (
              <span
                className="owner-notification-badge"
                aria-label={`Непрочитанных: ${unreadNotifications.length}`}
              >
                {unreadNotifications.length > 99
                  ? "99+"
                  : unreadNotifications.length}
              </span>
            )}
          </button>
          <ButtonX
            secondary
            disabled={loading}
            onClick={() => {
              void load();
              if (tab === "invites") void loadInviteStats();
            }}
          >
            {loading ? "Обновляем…" : "Обновить"}
          </ButtonX>
        </div>
        {notificationsOpen && (
          <section
            className="owner-notification-panel"
            role="dialog"
            aria-label="Уведомления о регистрациях"
          >
            <header>
              <div>
                <p className="eyebrow">УВЕДОМЛЕНИЯ</p>
                <h2>Новые регистрации</h2>
              </div>
              {unreadNotifications.length > 0 && (
                <button
                  type="button"
                  className="owner-notification-read-all"
                  onClick={() =>
                    markNotificationsRead(
                      unreadNotifications.map((item) => item.id),
                    )
                  }
                >
                  Прочитать все
                </button>
              )}
            </header>
            <div className="owner-notification-list">
              {notifications.map((item) => (
                <article
                  className={`owner-notification-item ${item.readBy?.[ownerUid] ? "" : "unread"}`}
                  key={item.id}
                >
                  <p className="eyebrow">
                    {notificationTitle(item)} · {date(item.createdAt)}
                  </p>
                  <h3>{item.fullName || item.email || "Пользователь"}</h3>
                  <p>{notificationDescription(item)}</p>
                  <button
                    type="button"
                    onClick={() => openNotificationProfile(item)}
                  >
                    {item.type === "registration_pending"
                      ? "Рассмотреть заявку"
                      : "Открыть профиль"}{" "}
                    <AppIcon name="arrow-right" size={15} />
                  </button>
                </article>
              ))}
              {!notifications.length && (
                <div className="owner-notification-empty">
                  <AppIcon name="bell" size={22} />
                  <h3>Пока нет уведомлений</h3>
                  <p>Подтверждённые регистрации появятся здесь.</p>
                </div>
              )}
            </div>
          </section>
        )}
        {!data && (
          <Card className="owner-note">
            <h2>Загружаем защищённую сводку…</h2>
            <p>
              Личные ответы участников в административную панель не передаются.
            </p>
          </Card>
        )}
        {data && tab === "overview" && (
          <>
            <header className="owner-header">
              <div>
                <p className="eyebrow">ПЛАТФОРМА · СВОДКА</p>
                <h1>Обзор</h1>
                <p className="owner-header-subtitle">
                  {date(period.from)} — {date(period.to)} · {timezone}
                </p>
              </div>
            </header>
            <div className="owner-metrics owner-metrics-wide">
              {metricCard(
                "Всего аккаунтов",
                data.metrics.totalAccounts,
                "за всё время",
                () => openUserList(""),
              )}
              {metricCard(
                "Новые регистрации",
                data.metrics.newRegistrations,
                "за период",
                () => openUserList("new"),
              )}
              {metricCard(
                "Активные сейчас",
                data.metrics.roomsActiveNow,
                "сбор или игра < 10 минут",
                () => openRoomList("active"),
              )}
              {metricCard(
                "Завершённые за период",
                data.metrics.roomsCompleted,
                "по времени завершения",
                () => openRoomList("completed"),
              )}
              {metricCard(
                "Неактивные / незавершённые",
                data.metrics.inactiveUnfinished,
                "не закрываются автоматически",
                () => openRoomList("inactive"),
              )}
            </div>
            <div className="owner-chart-grid">
              <Chart
                title="Регистрации и запуски"
                rows={data.charts.daily}
                fields={["registrations", "starts"]}
                legend={["Регистрации", "Запуски"]}
              />
              <Chart
                title="Подключения и завершения"
                rows={data.charts.daily}
                fields={["joins", "completions"]}
                legend={["Подключения", "Завершения"]}
              />
              <Card className="owner-graph">
                <h2>Режимы</h2>
                <p className="owner-empty-copy">
                  Самый популярный — по числу запусков.
                </p>
                <div className="owner-mode-usage">
                  {modes.map((item) => (
                    <button
                      type="button"
                      key={item.mode}
                      onClick={() => {
                        setSelectedMode(item.mode);
                        setTab("modes");
                      }}
                    >
                      <span>{modeName[item.mode]}</span>
                      <b>{item.started}</b>
                    </button>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
        {data && tab === "users" && !selectedUser && (
          <>
            <header className="owner-header">
              <div>
                <p className="eyebrow">АККАУНТЫ</p>
                <h1>Ведущие и доступы</h1>
                <p className="owner-header-subtitle">
                  Гости QR-комнат сюда не входят.
                </p>
              </div>
            </header>
            <div className="owner-metrics owner-metrics-wide">
              {metricCard(
                "Зарегистрировано",
                data.metrics.totalAccounts,
                "всего",
                () => setUserMetric(""),
              )}
              {metricCard(
                "Новые регистрации",
                data.metrics.newRegistrations,
                "за период",
                () => setUserMetric("new"),
              )}
              {metricCard(
                "Ведущие",
                data.metrics.leaders,
                "реальные аккаунты ведущих",
                () => setUserMetric(""),
              )}
              {metricCard(
                "Запускали комнату",
                data.metrics.activeHosts,
                "ведущие за период",
                () => setUserMetric("activeHosts"),
              )}
              {metricCard(
                "Заблокированные",
                data.metrics.blockedAccounts,
                "paused и revoked",
                () => setUserMetric("blocked"),
              )}
            </div>
            <Chart
              title="Регистрации по дням"
              rows={data.charts.daily}
              fields={["registrations"]}
              legend={["Регистрации"]}
            />
            <div className="owner-search">
              <input
                value={search}
                placeholder="Имя, email или ID"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && setAppliedSearch(search)
                }
              />
              <ButtonX onClick={() => setAppliedSearch(search)}>Найти</ButtonX>
            </div>
            <div className="owner-split">
              <Card className="owner-table-card">
                <div className="owner-table-scroll">
                  <table className="owner-table">
                    <thead>
                      <tr>
                        <th>Пользователь</th>
                        <th>Регистрация</th>
                        <th>Доступ</th>
                        <th>Активность</th>
                        <th>Комнаты</th>
                        <th>Участия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((user) => (
                        <tr
                          key={user.uid}
                          className={
                            selectedUserId === user.uid ? "selected" : ""
                          }
                          onClick={() => {
                            setSelectedUserId(user.uid);
                            setLeaderRoomMode("");
                            setLeaderRoomStatus("");
                          }}
                        >
                          <td>
                            <b>{user.fullName}</b>
                            <small>{user.email || "Email не доступен"}</small>
                          </td>
                          <td>{date(user.createdAt)}</td>
                          <td>
                            <span className={`owner-status ${user.status}`}>
                              {status[user.status]}
                            </span>
                          </td>
                          <td>{date(user.lastActiveAt)}</td>
                          <td>
                            {user.createdRooms} / {user.completedRooms}
                          </td>
                          <td>{user.roomParticipations}</td>
                        </tr>
                      ))}
                      {!data.users.length && (
                        <tr>
                          <td colSpan={6}>Ничего не найдено.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {selectedUser && (
                <Card className="leader-detail">
                  <p className="eyebrow">КАРТОЧКА ВЕДУЩЕГО</p>
                  {leaderDetailsError && (
                    <p className="owner-error">{leaderDetailsError}</p>
                  )}
                  {!leaderDetails && !leaderDetailsError && (
                    <p>Загружаем поля регистрации и комнаты…</p>
                  )}
                  {leaderDetails && (
                    <>
                      <h2>{leaderDetails.profile.fullName || "Не указано"}</h2>
                      <dl>
                        <div>
                          <dt>Email</dt>
                          <dd>{leaderDetails.profile.email || "Не указано"}</dd>
                        </div>
                        <div>
                          <dt>Телефон</dt>
                          <dd>{leaderDetails.profile.phone || "Не указано"}</dd>
                        </div>
                        <div>
                          <dt>Молодёжная группа / организация</dt>
                          <dd>
                            {leaderDetails.workspace?.name || "Не указано"}
                          </dd>
                        </div>
                        <div>
                          <dt>Город</dt>
                          <dd>
                            {leaderDetails.workspace?.city || "Не указано"}
                          </dd>
                        </div>
                        <div>
                          <dt>Дата регистрации</dt>
                          <dd>{date(leaderDetails.profile.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>Роль</dt>
                          <dd>Ведущий</dd>
                        </div>
                        <div>
                          <dt>Доступ</dt>
                          <dd>{status[leaderDetails.profile.status]}</dd>
                        </div>
                        <div>
                          <dt>Способ доступа</dt>
                          <dd>
                            {leaderDetails.profile.accessSource === "invite"
                              ? "Приглашение"
                              : leaderDetails.profile.accessSource ===
                                  "approval"
                                ? "Одобрение администратора"
                                : leaderDetails.profile.accessSource ||
                                  "Не указано"}
                          </dd>
                        </div>
                      </dl>
                      <div className="leader-room-filters">
                        <select
                          value={leaderRoomMode}
                          onChange={(event) =>
                            setLeaderRoomMode(event.target.value)
                          }
                        >
                          <option value="">Все режимы</option>
                          {Object.entries(modeName).map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={leaderRoomStatus}
                          onChange={(event) =>
                            setLeaderRoomStatus(event.target.value)
                          }
                        >
                          <option value="">Все статусы</option>
                          {Object.entries(roomState).map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="eyebrow">
                        КОМНАТЫ · {leaderDetails.totalRooms}
                      </p>
                      <div className="leader-room-list">
                        {leaderDetails.rooms.map((room) => (
                          <button
                            type="button"
                            key={room.roomId}
                            onClick={openLeaderRooms}
                          >
                            <b>{room.roomTitle}</b>
                            <small>
                              {modeName[room.mode]} · {date(room.createdAt)} ·{" "}
                              {room.participantCount} участников ·{" "}
                              {room.endedAt
                                ? `завершена ${date(room.endedAt)}`
                                : roomState[room.operationalStatus]}
                            </small>
                          </button>
                        ))}
                        {!leaderDetails.rooms.length && (
                          <p>Комнат по выбранным фильтрам нет.</p>
                        )}
                      </div>
                      {leaderDetails.nextOffset !== null && (
                        <ButtonX
                          secondary
                          onClick={() =>
                            void getOwnerLeaderDetails(
                              leaderDetails.profile.uid,
                              {
                                mode: leaderRoomMode,
                                roomStatus: leaderRoomStatus,
                                offset: leaderDetails.rooms.length,
                              },
                            )
                              .then((page) =>
                                setLeaderDetails({
                                  ...page,
                                  rooms: [
                                    ...leaderDetails.rooms,
                                    ...page.rooms,
                                  ],
                                }),
                              )
                              .catch((cause) =>
                                setLeaderDetailsError(
                                  cause instanceof Error
                                    ? cause.message
                                    : "Не удалось загрузить следующую страницу.",
                                ),
                              )
                          }
                        >
                          Загрузить ещё
                        </ButtonX>
                      )}
                      <ButtonX secondary onClick={openLeaderRooms}>
                        Открыть комнаты в списке
                      </ButtonX>
                    </>
                  )}
                  <div className="owner-actions">
                    <ButtonX
                      disabled={saving || (selectedUser as OwnerDashboard['users'][number]).status === "active"}
                      onClick={() =>
                        setConfirm({ uid: (selectedUser as OwnerDashboard['users'][number]).uid, next: "active" })
                      }
                    >
                      Восстановить
                    </ButtonX>
                    <ButtonX
                      secondary
                      disabled={saving || (selectedUser as OwnerDashboard['users'][number]).status === "paused"}
                      onClick={() =>
                        setConfirm({ uid: (selectedUser as OwnerDashboard['users'][number]).uid, next: "paused" })
                      }
                    >
                      Заблокировать
                    </ButtonX>
                    <ButtonX
                      danger
                      disabled={saving || (selectedUser as OwnerDashboard['users'][number]).status === "revoked"}
                      onClick={() =>
                        setConfirm({ uid: (selectedUser as OwnerDashboard['users'][number]).uid, next: "revoked" })
                      }
                    >
                      Отозвать
                    </ButtonX>
                    <ButtonX
                      danger
                      disabled={saving}
                      onClick={() => void openDeletionPreview()}
                    >
                      Удалить ведущего и его данные
                    </ButtonX>
                  </div>
                </Card>
              )}
            </div>
          </>
        )}
        {data && tab === "users" && selectedUser && (
          <LeaderDetailsScreen
            user={selectedUser}
            details={leaderDetails}
            error={leaderDetailsError}
            roomMode={leaderRoomMode}
            roomStatus={leaderRoomStatus}
            saving={saving}
            onBack={() => { setSelectedUserId(""); setLeaderDetails(null); setLeaderDetailsError("") }}
            onRoomMode={setLeaderRoomMode}
            onRoomStatus={setLeaderRoomStatus}
            onLoadMore={() => { if (!leaderDetails) return; void getOwnerLeaderDetails(leaderDetails.profile.uid, { mode: leaderRoomMode, roomStatus: leaderRoomStatus, offset: leaderDetails.rooms.length }).then(page => setLeaderDetails({ ...page, rooms: [...leaderDetails.rooms, ...page.rooms] })).catch(cause => setLeaderDetailsError(cause instanceof Error ? cause.message : "Не удалось загрузить следующую страницу.")) }}
            onOpenRooms={openLeaderRooms}
            onAccess={next => setConfirm({ uid: selectedUser.uid, next })}
            onDelete={() => void openDeletionPreview()}
          />
        )}
        {data && tab === "invites" && (
          <>
            <header className="owner-header">
              <div>
                <p className="eyebrow">ДОСТУП ПО ПРИГЛАШЕНИЮ</p>
                <h1>Коды приглашения</h1>
                <p className="owner-header-subtitle">
                  Статистика использует защищённые записи кодов, а не список аккаунтов.
                </p>
              </div>
            </header>
            <InvitationCodes invites={inviteStats} error={inviteStatsError} onRefresh={() => void loadInviteStats()} />
          </>
        )}
        {data && tab === "rooms" && (
          <>
            <header className="owner-header">
              <div>
                <p className="eyebrow">КОМНАТЫ</p>
                <h1>Статистика и список</h1>
                <p className="owner-header-subtitle">
                  Активность сейчас не зависит от выбранного периода; статус не
                  меняет жизненный цикл игры.
                </p>
              </div>
            </header>
            <div className="owner-metrics owner-metrics-wide">
              {metricCard(
                "Создано",
                data.metrics.roomsCreated,
                "по createdAt",
                () => openRoomList("created"),
              )}
              {metricCard(
                "Запущено",
                data.metrics.roomsStarted,
                "по startedAt",
                () => openRoomList("started"),
              )}
              {metricCard(
                "Завершено",
                data.metrics.roomsCompleted,
                "по endedAt / closedAt",
                () => openRoomList("completed"),
              )}
              {metricCard(
                "Активно сейчас",
                data.metrics.roomsActiveNow,
                "открытый сбор или игра",
                () => openRoomList("active"),
              )}
              {metricCard(
                "Неактивно",
                data.metrics.inactiveUnfinished,
                "незавершённые",
                () => openRoomList("inactive"),
              )}
            </div>
            <div className="owner-chart-grid">
              <Chart
                title="Комнаты по дням"
                rows={data.charts.daily}
                fields={["roomCreated", "starts", "roomCompleted"]}
                legend={["Создано", "Запущено", "Завершено"]}
              />
              <Card className="owner-graph">
                <h2>Распределение по режимам</h2>
                <div className="owner-mode-usage">
                  {modes.map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => {
                        setModeFilter(item.mode);
                        setRoomMetric("");
                        setTab("rooms");
                      }}
                    >
                      <span>{modeName[item.mode]}</span>
                      <b>{item.started} запусков</b>
                    </button>
                  ))}
                </div>
              </Card>
            </div>
            <div className="owner-search">
              <input
                value={search}
                placeholder="Название, код или ID ведущего"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && setAppliedSearch(search)
                }
              />
              <select
                value={modeFilter}
                onChange={(event) => setModeFilter(event.target.value)}
              >
                <option value="">Все режимы</option>
                {Object.entries(modeName).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={hostFilter}
                onChange={(event) => setHostFilter(event.target.value)}
              >
                <option value="">Все ведущие</option>
                {data.users.map((user) => (
                  <option key={user.uid} value={user.uid}>
                    {user.fullName}
                  </option>
                ))}
              </select>
              <select
                value={roomStatus}
                onChange={(event) => setRoomStatus(event.target.value)}
              >
                <option value="">Все статусы</option>
                {Object.entries(roomState).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <ButtonX onClick={() => setAppliedSearch(search)}>
                Фильтровать
              </ButtonX>
            </div>
            <Card className="owner-table-card">
              <div className="owner-table-scroll">
                <table className="owner-table">
                  <thead>
                    <tr>
                      <th>Комната</th>
                      <th>Ведущий</th>
                      <th>Режим</th>
                      <th>Время</th>
                      <th>Участники</th>
                      <th>Состояние</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rooms.map((room) => (
                      <tr key={room.roomId}>
                        <td>
                          <b>{room.roomTitle}</b>
                          <small>Код: {room.displayCode}</small>
                        </td>
                        <td>
                          {data.users.find((user) => user.uid === room.hostUid)
                            ?.fullName || room.hostUid}
                        </td>
                        <td>{modeName[room.mode]}</td>
                        <td>
                          {date(room.createdAt)}
                          <small>
                            {room.startedAt
                              ? `Старт: ${date(room.startedAt)}`
                              : "Не запускалась"}
                            {room.endedAt
                              ? ` · Конец: ${date(room.endedAt)}`
                              : room.operationalStatus === "completed"
                                ? " · Время завершения не сохранено"
                                : ""}
                          </small>
                        </td>
                        <td>
                          {room.participantCount} / {room.completedCount}
                        </td>
                        <td>
                          <span
                            className={`owner-status ${room.operationalStatus === "active" ? "active" : room.operationalStatus === "completed" ? "revoked" : "pending"}`}
                          >
                            {roomState[room.operationalStatus]}
                            <small>
                              {room.lastActivityAt
                                ? `Активность: ${date(room.lastActivityAt)}`
                                : "Нет отметки активности"}
                            </small>
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!data.rooms.length && (
                      <tr>
                        <td colSpan={6}>Нет комнат по заданным условиям.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
        {data && tab === "modes" && (
          <>
            <header className="owner-header">
              <div>
                <p className="eyebrow">РЕЖИМЫ</p>
                <h1>Сравнение форматов</h1>
                <p className="owner-header-subtitle">
                  Популярность определяется количеством запусков комнаты.
                </p>
              </div>
            </header>
            <div className="owner-mode-grid">
              {modes.map((item) => (
                <button
                  type="button"
                  key={item.mode}
                  className={selectedMode === item.mode ? "selected" : ""}
                  onClick={() => setSelectedMode(item.mode)}
                >
                  <b>{modeName[item.mode]}</b>
                  <span>
                    {item.started} запусков · {item.completed} завершено
                  </span>
                  <small>
                    {item.leaders} ведущих · {count(item.participations)}{" "}
                    участий
                  </small>
                </button>
              ))}
            </div>
            {selectedModeData && (
              <>
                <div className="owner-metrics owner-metrics-wide">
                  {metricCard(
                    "Создано",
                    selectedModeData.created,
                    "за период",
                    () => openRoomList("created", selectedModeData.mode),
                  )}
                  {metricCard(
                    "Запущено",
                    selectedModeData.started,
                    "за период",
                    () => openRoomList("started", selectedModeData.mode),
                  )}
                  {metricCard(
                    "Завершено",
                    selectedModeData.completed,
                    "за период",
                    () => openRoomList("completed", selectedModeData.mode),
                  )}
                  {metricCard(
                    "Активно сейчас",
                    selectedModeData.activeNow,
                    "не зависит от периода",
                    () => openRoomList("active", selectedModeData.mode),
                  )}
                  {metricCard(
                    "Ведущие",
                    selectedModeData.leaders,
                    "использовали режим",
                    () => openRoomList("", selectedModeData.mode),
                  )}
                </div>
                <Card className="owner-note">
                  <h2>{modeName[selectedModeData.mode]}</h2>
                  <p>
                    Участия: {count(selectedModeData.participations)};
                    завершения прохождений:{" "}
                    {count(selectedModeData.completedRuns)}. У колеса подготовка
                    ведущим может проходить без подключений с телефонов; это не
                    считается ошибкой. Имена колеса не являются аккаунтами.
                  </p>
                </Card>
              </>
            )}
          </>
        )}
        {data && tab === "modes" && selectedModeData && (
          <div className="owner-two-columns">
            <ModeLaunchChart rows={selectedModeData.dailyStarts} />
            <Card className="owner-note">
              <h2>Список комнат режима</h2>
              <p>
                Список учитывает текущий фильтр периода и не раскрывает личные
                ответы участников.
              </p>
              <ButtonX onClick={() => openRoomList("", selectedModeData.mode)}>
                Открыть комнаты режима
              </ButtonX>
            </Card>
          </div>
        )}
        {data && tab === "activity" && (
          <>
            <header className="owner-header">
              <p className="eyebrow">АУДИТ</p>
              <h1>Журнал действий</h1>
            </header>
            <Card className="owner-table-card">
              <div className="owner-table-scroll">
                <table className="owner-table">
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>Действие</th>
                      <th>Кто</th>
                      <th>Объект</th>
                      <th>Причина</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activity.map((item) => (
                      <tr key={item.id}>
                        <td>{date(item.createdAt)}</td>
                        <td>{eventName[item.type] || item.type}</td>
                        <td>
                          {data.users.find((user) => user.uid === item.actorUid)
                            ?.fullName ||
                            item.actorUid ||
                            "Система"}
                        </td>
                        <td>{item.targetName || item.targetId || "—"}</td>
                        <td>{item.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
        {data && tab === "library" && (
          <>
            <header className="owner-header">
              <div>
                <p className="eyebrow">БИБЛИОТЕКА И ДОСТУПЫ</p>
                <h1>Наборы и продукты</h1>
              </div>
              <ButtonX
                secondary
                disabled={saving}
                onClick={() => void publish()}
              >
                Синхронизировать публикации
              </ButtonX>
            </header>
            <OwnerProducts
              products={data.products}
              workspaces={data.workspaces}
              workspaceProducts={data.workspaceProducts}
              saving={saving}
              onSaving={setSaving}
              onError={setError}
            />
          </>
        )}
        {data && tab === "feedback" && (
          <>
            <header className="owner-header">
              <p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p>
              <h1>Отзывы</h1>
            </header>
            <div className="owner-feedback-list">
              {Object.values(data.feedback)
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((item) => (
                  <Card key={item.id} className="owner-feedback-card">
                    <p className="eyebrow">
                      {date(item.createdAt)} ·{" "}
                      {data.workspaces[item.workspaceId]?.name ||
                        "Без молодёжки"}
                    </p>
                    <h2>
                      {data.users.find((user) => user.uid === item.uid)
                        ?.fullName || item.uid}
                    </h2>
                    <p>{item.message}</p>
                  </Card>
                ))}
              {!Object.keys(data.feedback).length && (
                <Card>
                  <h2>Интеграция обратной связи не подключена</h2>
                  <p>В доступной базе нет отзывов.</p>
                </Card>
              )}
            </div>
          </>
        )}
        {confirm && selectedUser && (
          <div className="owner-modal-backdrop">
            <Card className="owner-confirm">
              <p className="eyebrow">ПОДТВЕРДИТЕ ИЗМЕНЕНИЕ ДОСТУПА</p>
              <h2>
                {confirm.next === "active"
                  ? "Восстановить доступ"
                  : "Ограничить доступ"}
              </h2>
              <p>
                Пользователь: <b>{selectedUser.fullName}</b>. Текущая комната не
                завершится автоматически.
              </p>
              <label>
                Причина (необязательно)
                <textarea
                  value={reason}
                  maxLength={300}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="owner-actions">
                <ButtonX
                  danger={confirm.next !== "active"}
                  disabled={saving}
                  onClick={() => void changeAccess()}
                >
                  Подтвердить
                </ButtonX>
                <ButtonX secondary onClick={() => setConfirm(null)}>
                  Отмена
                </ButtonX>
              </div>
            </Card>
          </div>
        )}
        {deletionPreview && (
          <div className="owner-modal-backdrop">
            <Card className="owner-confirm owner-delete-confirm">
              <p className="eyebrow">НЕОБРАТИМОЕ УДАЛЕНИЕ</p>
              <h2>Удалить ведущего и его данные?</h2>
              <p>
                <b>{deletionPreview.fullName || "Без имени"}</b>
                <br />
                {deletionPreview.email || "Email не указан"}
              </p>
              <dl>
                <div><dt>Комнаты</dt><dd>{deletionPreview.summary.totalRooms} (диагностика: {deletionPreview.summary.rooms.diagnostic || 0}, викторина: {deletionPreview.summary.rooms.quiz || 0}, колесо: {deletionPreview.summary.rooms.wheel || 0})</dd></div>
                <div><dt>Участники / результаты</dt><dd>{deletionPreview.summary.participantRecords} / {deletionPreview.summary.resultRecords}</dd></div>
                <div><dt>Отзывы</dt><dd>{deletionPreview.summary.feedbackRecords}</dd></div>
                <div><dt>Рабочее пространство</dt><dd>{deletionPreview.summary.personalWorkspace ? `Личное; наборов: ${deletionPreview.summary.personalPacks}` : deletionPreview.summary.sharedWorkspacePreserved ? "Общее — будет сохранено" : "Не указано"}</dd></div>
              </dl>
              <p>Операция необратима: будут удалены учётная запись, профиль, комнаты, публичные записи, подключения, ответы, результаты, архивы и личные данные рабочего пространства. Общая библиотека, приглашения и данные других ведущих сохраняются.</p>
              {deletionPreview.summary.activeRooms.length > 0 && <div className="owner-delete-active"><p className="owner-error">Удаление временно недоступно: сначала завершите активные комнаты.</p>{deletionPreview.summary.activeRooms.map(room => <div key={room.roomId}><b>{room.roomTitle}</b><small>{modeName[room.mode] || room.mode}</small><ButtonX secondary disabled={saving} onClick={() => void closeActiveLeaderRoom(room.roomId)}>Завершить комнату</ButtonX></div>)}</div>}
              {deletionProgress && <p className="owner-help" role="status">{deletionProgress}</p>}
              {deletionError && <p className="owner-error">{deletionError}</p>}
              <div className="owner-actions">
                {deletionPreview.summary.activeRooms.length === 0 && <ButtonX danger disabled={saving} onClick={() => void deleteLeader()}>Удалить ведущего и данные</ButtonX>}
                <ButtonX secondary disabled={saving} onClick={() => setDeletionPreview(null)}>Отмена</ButtonX>
              </div>
            </Card>
          </div>
        )}
        <div
          className="owner-notification-toast-stack"
          aria-live="polite"
          aria-atomic="false"
        >
          {toastIds.map((id) => {
            const item = notifications.find((candidate) => candidate.id === id);
            return item ? (
              <article className="owner-notification-toast" key={item.id}>
                <div>
                  <p className="eyebrow">{notificationTitle(item)}</p>
                  <strong>
                    {item.fullName || item.email || "Пользователь"}
                  </strong>
                  <p>{notificationDescription(item)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openNotificationProfile(item)}
                >
                  {item.type === "registration_pending"
                    ? "Рассмотреть"
                    : "Открыть"}
                </button>
              </article>
            ) : null;
          })}
        </div>
      </section>
    </main>
  );
}
