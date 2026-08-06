/**
 * 地域帯（寒冷地・中間地・暖地）の選択肢（WBS 3.6）。
 * 初回起動の聞き取りと、設定の地域画面の両方で使う。
 */
import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { REGION_DESCRIPTION, REGION_LABEL, REGIONS, type Region } from '../services/region.service';
import { PressableScale } from './PressableScale';

interface RegionOptionsProps {
  value: Region;
  onChange: (region: Region) => void;
}

export function RegionOptions({ value, onChange }: RegionOptionsProps) {
  return (
    <View style={styles.list}>
      {REGIONS.map((region) => {
        const active = value === region;
        return (
          <PressableScale
            key={region}
            style={[styles.card, active && styles.cardActive]}
            onPress={() => onChange(region)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={REGION_LABEL[region]}
          >
            <View style={styles.cardText}>
              <Text style={[styles.label, active && styles.labelActive]}>
                {REGION_LABEL[region]}
              </Text>
              <Text style={styles.description}>{REGION_DESCRIPTION[region]}</Text>
            </View>
            {active ? <Check size={18} color={Colors.accent} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  cardActive: {
    borderRadius: 12,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  cardText: { flex: 1, gap: 3 },
  label: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  labelActive: { color: Colors.accentInk },
  description: { fontSize: Typography.size.sm, color: Colors.inkDim },
});
