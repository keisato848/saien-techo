/**
 * S15: Settings hub
 * Account, family, data management, and app info sections
 */
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { CoachMarkOverlay } from '../../src/components/CoachMarkOverlay';
import { HelpButton } from '../../src/components/HelpButton';
import { Colors } from '../../src/constants/theme';
import { useCoachMarks } from '../../src/hooks/useCoachMarks';
import { resetCoachMarks } from '../../src/services/coach-marks.service';
import {
  getCurrentFamily,
  getCurrentFamilyProfile,
  getCurrentUser,
  getCurrentUserProfile,
} from '../../src/services/user.service';
import { getRegion, REGION_LABEL, type Region } from '../../src/services/region.service';
import { formatProfileDisplayName } from '../../src/utils/profile';

interface SettingItem {
  id: string;
  label: string;
  subtitle?: string;
  statusLabel?: string;
  enabled: boolean;
  onPress?: () => void;
}

interface SettingSection {
  title: string;
  items: SettingItem[];
}

const APP_VERSION_LABEL = `v${Constants.expoConfig?.version ?? '1.1.0'}`;
const FUTURE_STATUS_LABEL = '今後追加予定';

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState(getCurrentUser());
  const [family, setFamily] = useState(getCurrentFamily());
  const [region, setRegionState] = useState<Region | null>(null);
  const userDisplayName = formatProfileDisplayName(user.displayName);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([getCurrentUserProfile(), getCurrentFamilyProfile()]).then(
        ([nextUser, nextFamily]) => {
          setUser(nextUser);
          setFamily(nextFamily);
        },
      );
      void getRegion()
        .then(setRegionState)
        .catch(() => setRegionState(null));
    }, []),
  );

  const showComingSoon = () => {
    Alert.alert('準備中', 'この機能は今後のバージョンで追加予定です。');
  };

  // 初回利用ガイド（コーチマーク）
  // プラン節（freemium・BYOK・広告）は WBS 2.9b で外した。v1.5 で作り直す。
  const backupRef = useRef<View>(null);
  const coach = useCoachMarks('settings', [
    {
      key: 'backup',
      title: 'データを守る',
      text: 'データは端末内に保存されます。「バックアップ・復元」でファイルに書き出し・復元ができます。',
      ref: backupRef,
    },
    {
      key: 'guide',
      title: '使い方ガイド',
      text: '各画面の「?」でその画面の案内を再生できます。「使い方ガイドを再表示」を押すと全画面の案内をもう一度見られます。',
    },
  ]);

  const sections: SettingSection[] = [
    {
      title: 'アカウント',
      items: [
        {
          id: 'profile',
          label: 'プロフィール編集',
          subtitle: userDisplayName,
          // 遷移先はだいどこの家族画面だった。設定画面の作り直しは WBS 3.6。
          enabled: false,
        },
      ],
    },
    {
      title: '菜園',
      items: [
        {
          id: 'places',
          label: '場所の管理',
          subtitle: 'プランター・畝・区画の登録と並べ替え',
          enabled: true,
          onPress: () => router.push('/places'),
        },
        {
          id: 'materials',
          label: '資材の在庫',
          subtitle: '種・肥料・薬剤の残りを記録し、少なくなったらお知らせ',
          enabled: true,
          onPress: () => router.push('/materials'),
        },
        {
          id: 'region',
          label: 'お住まいの地域',
          subtitle: region
            ? `${REGION_LABEL[region]}の栽培暦で表示します`
            : '未設定（中間地として表示します）',
          enabled: true,
          onPress: () => router.push('/region'),
        },
      ],
    },
    {
      title: 'データ',
      items: [
        {
          id: 'backup',
          label: 'バックアップ・復元',
          subtitle: '端末内にバックアップを作成・復元',
          enabled: true,
          onPress: () => router.push('/(tabs)/backup'),
        },
        {
          id: 'sync',
          label: 'クラウド同期',
          subtitle: '現在は端末内のみ保存されます',
          statusLabel: FUTURE_STATUS_LABEL,
          enabled: false,
          onPress: showComingSoon,
        },
      ],
    },
    {
      title: 'アプリ',
      items: [
        {
          id: 'coach-marks',
          label: '使い方ガイドを再表示',
          subtitle: '各画面の操作案内をもう一度表示します',
          enabled: true,
          onPress: () => {
            void resetCoachMarks().then(() => {
              Alert.alert('使い方ガイド', '各画面を開くと操作案内が再表示されます。');
            });
          },
        },
        {
          id: 'version',
          label: 'バージョン',
          subtitle: APP_VERSION_LABEL,
          enabled: true,
        },
        {
          id: 'licenses',
          label: 'ライセンス情報',
          subtitle: '利用している OSS ライセンスを表示',
          enabled: true,
          onPress: () => router.push('/(tabs)/licenses'),
        },
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>設定</Text>
        <HelpButton onPress={coach.show} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* User card */}
        <View style={styles.userCard}>
          <Avatar name={userDisplayName} size={48} />
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{userDisplayName}</Text>
            <Text style={styles.familyName}>{family.name}</Text>
          </View>
        </View>

        {/* Setting sections */}
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <Pressable
                key={item.id}
                ref={item.id === 'backup' ? backupRef : undefined}
                collapsable={false}
                style={[styles.settingRow, !item.enabled && styles.settingRowDisabled]}
                onPress={item.onPress}
                disabled={!item.onPress}
              >
                <View style={styles.settingContent}>
                  <Text style={[styles.settingLabel, !item.enabled && styles.settingLabelDisabled]}>
                    {item.label}
                  </Text>
                  {item.subtitle && <Text style={styles.settingSubtitle}>{item.subtitle}</Text>}
                  {item.statusLabel && <Text style={styles.statusBadge}>{item.statusLabel}</Text>}
                </View>
                {item.onPress && (
                  <ChevronRight size={16} color={item.enabled ? Colors.goldDim : Colors.muted} />
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <CoachMarkOverlay
        visible={coach.visible}
        step={coach.step}
        index={coach.index}
        total={coach.total}
        onNext={coach.next}
        onSkip={coach.skip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 20, // lg: 画面タイトル
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  userInfo: {
    gap: 2,
  },
  userName: {
    fontSize: 17, // md: ユーザー名
    fontWeight: '500',
    color: Colors.paper,
  },
  familyName: {
    fontSize: 13, // sm: 家族名
    fontWeight: '400',
    color: Colors.paperDim,
  },
  section: {
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 12, // xs: セクションヘッダー（大文字化で強調）
    fontWeight: '500',
    color: Colors.goldDim,
    letterSpacing: 2,
    paddingHorizontal: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  settingRowDisabled: {
    opacity: 0.6,
  },
  settingContent: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontSize: 15, // base: 設定項目ラベル
    fontWeight: '400',
    color: Colors.paper,
  },
  settingLabelDisabled: {
    color: Colors.paperDim,
  },
  settingSubtitle: {
    fontSize: 13, // sm: 設定項目の補足
    fontWeight: '400',
    color: Colors.paperDim,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.goldDim,
    color: Colors.goldDim,
    fontSize: 11,
    fontWeight: '500',
  },
});
