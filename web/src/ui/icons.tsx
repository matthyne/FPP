import { ICONS, IconName } from '../core/icons';

export { ICONS };


export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg class="mdi" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}
