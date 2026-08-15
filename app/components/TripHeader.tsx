import Link from "next/link";

type TripHeaderProps = {
  tripSlug: string;
  tripName: string;
  avatarUrl?: string | null;
};

// 移動は下部タブに集約したので、ヘッダーは旅行名とアバターだけに減らす。
export default function TripHeader({ tripSlug, tripName, avatarUrl = null }: TripHeaderProps) {
  return (
    <header className="trip-header">
      <Link className="trip-header-brand" href={`/trips/${tripSlug}`}>
        <strong>{tripName}</strong>
      </Link>
      <Link className="trip-header-user" href={`/trips/${tripSlug}/me`} aria-label="自分のプロフィール" title="自分のプロフィール">
        {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">👤</span>}
      </Link>
    </header>
  );
}
