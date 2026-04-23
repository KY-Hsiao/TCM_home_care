import type { Patient } from "../../domain/models";
import { mapsLink, stamp } from "./helpers";

const patientCoordinates: Record<
  string,
  { latitude: number | null; longitude: number | null; geocoding_status: Patient["geocoding_status"] }
> = {
  "pat-001": { latitude: 22.88861, longitude: 120.4842, geocoding_status: "resolved" },
  "pat-002": { latitude: 22.89234, longitude: 120.49381, geocoding_status: "resolved" },
  "pat-003": { latitude: 22.88592, longitude: 120.50144, geocoding_status: "resolved" },
  "pat-004": { latitude: 22.90021, longitude: 120.54862, geocoding_status: "resolved" },
  "pat-005": { latitude: 22.89783, longitude: 120.54195, geocoding_status: "resolved" },
  "pat-006": { latitude: 22.90511, longitude: 120.53327, geocoding_status: "resolved" },
  "pat-007": { latitude: 22.88147, longitude: 120.47433, geocoding_status: "approximate" },
  "pat-008": { latitude: 22.89496, longitude: 120.48752, geocoding_status: "resolved" },
  "pat-009": { latitude: 22.91244, longitude: 120.54618, geocoding_status: "approximate" },
  "pat-010": { latitude: 22.90688, longitude: 120.55743, geocoding_status: "resolved" },
  "pat-011": { latitude: null, longitude: null, geocoding_status: "missing" },
  "pat-012": { latitude: 22.91475, longitude: 120.55284, geocoding_status: "pending" },
  "pat-013": { latitude: 22.88927, longitude: 120.47869, geocoding_status: "resolved" },
  "pat-014": { latitude: 22.88392, longitude: 120.49238, geocoding_status: "resolved" },
  "pat-015": { latitude: 22.90164, longitude: 120.53791, geocoding_status: "resolved" },
  "pat-016": { latitude: 22.90943, longitude: 120.54437, geocoding_status: "resolved" }
};

const patientRows = [
  ["pat-001", "A0001", "王麗珠", "女", "1947-06-08", "02-2933-1101", "高雄市旗山區延平一路 128 號", "高齡衰弱與慢性腰痛", "穩定追蹤", "active"],
  ["pat-002", "A0002", "陳正雄", "男", "1943-11-22", "02-2933-1102", "高雄市旗山區中華路 76 號", "腦中風後復能", "家屬高度配合", "active"],
  ["pat-003", "A0003", "李美蘭", "女", "1951-03-14", "02-2933-1103", "高雄市旗山區大德路 52 號", "糖尿病合併失眠", "夜間情緒波動", "active"],
  ["pat-004", "A0004", "周文德", "男", "1938-10-03", "02-2933-1104", "高雄市美濃區中正路一段 210 號", "退化性膝關節炎", "需輪椅協助", "active"],
  ["pat-005", "A0005", "郭秋月", "女", "1949-01-30", "02-2933-1105", "高雄市美濃區成功路 168 號", "帕金森氏症居家照護", "早上狀態較佳", "active"],
  ["pat-006", "A0006", "黃建民", "男", "1954-08-09", "02-2933-1106", "高雄市美濃區泰安路 95 號", "慢性阻塞性肺病", "近期曾調整藥物", "active"],
  ["pat-007", "A0007", "蔡玉琴", "女", "1939-12-18", "02-2933-1107", "高雄市旗山區永平街 34 號", "長期臥床與便祕調理", "需先電話通知", "active"],
  ["pat-008", "A0008", "鄭國華", "男", "1945-05-27", "02-2933-1108", "高雄市旗山區復新東街 41 號", "中風後肩頸僵硬", "已建立固定排程", "active"],
  ["pat-009", "A0009", "蕭瑞芬", "女", "1950-09-01", "02-2933-1109", "高雄市美濃區民族路 86 號", "慢性胃食道逆流", "飲食需追蹤", "active"],
  ["pat-010", "A0010", "劉錦堂", "男", "1936-04-16", "02-2933-1110", "高雄市美濃區中興路一段 132 號", "癌後虛弱調理", "家屬希望固定上午", "active"],
  ["pat-011", "A0011", "何阿惜", "女", "1935-02-02", "02-2933-1111", "高雄市旗山區樂和街 27 號", "失智症合併睡眠障礙", "近一個月改為月訪", "active"],
  ["pat-012", "A0012", "彭世傑", "男", "1948-07-19", "02-2933-1112", "高雄市美濃區中山路二段 118 號", "慢性腰背痛與虛弱", "近期住院後暫停", "active"],
  ["pat-013", "A0013", "許秋蓮", "女", "1946-10-05", "02-2933-1113", "高雄市旗山區德義街 63 號", "慢性肩頸僵硬", "上午時段較穩定", "active"],
  ["pat-014", "A0014", "張順發", "男", "1941-01-17", "02-2933-1114", "高雄市旗山區永福街 49 號", "退化性膝痛與步態不穩", "家屬可配合上午", "active"],
  ["pat-015", "A0015", "吳玉鳳", "女", "1952-12-21", "02-2933-1115", "高雄市美濃區福安街 58 號", "睡眠障礙與慢性疲倦", "下午較方便安排", "active"],
  ["pat-016", "A0016", "陳清山", "男", "1944-06-29", "02-2933-1116", "高雄市美濃區民權路 72 號", "慢性腰背痛與食慾下降", "下午施作較穩定", "active"]
] as const;

const patientCareExtras: Record<
  string,
  Pick<
    Patient,
    | "preferred_doctor_id"
    | "important_medical_history"
    | "precautions"
    | "medication_summary"
    | "last_visit_summary"
    | "next_follow_up_focus"
    | "reminder_tags"
  >
> = {
  "pat-001": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "慢性腰痛、退化性關節變化，近半年行走耐力下降。",
    precautions: "上下樓梯需陪同，治療後提醒補充水分與熱敷。",
    medication_summary: "止痛藥 PRN、鈣片、降壓藥固定服用。",
    last_visit_summary: "上次訪視後腰痛分數下降，夜間翻身較順。",
    next_follow_up_focus: "持續追蹤疼痛、睡眠與居家活動量。",
    reminder_tags: ["慢性腰痛", "固定週追蹤"]
  },
  "pat-002": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "腦中風後右側無力，持續進行居家復能。",
    precautions: "轉位時需家屬協助，訪視前先確認當日復健課程。",
    medication_summary: "抗血小板藥、降血脂藥、復健輔助營養品。",
    last_visit_summary: "家屬配合度高，復能動作已有進步。",
    next_follow_up_focus: "觀察肩關節活動度與居家訓練紀錄。",
    reminder_tags: ["復能追蹤", "家屬高度配合"]
  },
  "pat-003": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "糖尿病、失眠，夜間情緒波動明顯。",
    precautions: "訪後需提供簡短睡眠摘要給家屬。",
    medication_summary: "糖尿病口服藥、睡前安眠藥、保健食品。",
    last_visit_summary: "已請家屬記錄睡眠中斷次數，待本次比對。",
    next_follow_up_focus: "睡眠品質、情緒與夜間進食情況。",
    reminder_tags: ["睡眠追蹤", "需 Google Chat 摘要"]
  },
  "pat-004": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "退化性膝關節炎，外出需輪椅協助。",
    precautions: "到達前 30 分需先通知，注意上下電梯動線。",
    medication_summary: "止痛藥、肌肉鬆弛劑、骨關節保健品。",
    last_visit_summary: "膝痛於天冷時加劇，家屬希望加強衛教。",
    next_follow_up_focus: "疼痛變化、站立時間與居家運動耐受度。",
    reminder_tags: ["輪椅協助", "疼痛照護"]
  },
  "pat-005": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "帕金森氏症，清晨與上午精神較佳。",
    precautions: "留意起身與轉身時的平衡，避免安排太晚。",
    medication_summary: "多巴胺製劑、便祕改善藥、睡前營養補充。",
    last_visit_summary: "家屬已整理近三日起身狀況待醫師查看。",
    next_follow_up_focus: "步態、起身速度與跌倒風險。",
    reminder_tags: ["上午優先", "跌倒風險"]
  },
  "pat-006": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "慢性阻塞性肺病，近期吸入器劑量調整。",
    precautions: "需同步衛教呼吸照護與吸入器使用節奏。",
    medication_summary: "吸入型支氣管擴張劑、化痰藥、夜間氧療。",
    last_visit_summary: "治療中呼吸較穩，家屬希望收到照護節奏提醒。",
    next_follow_up_focus: "喘促程度、用藥依從性與夜間睡眠。",
    reminder_tags: ["呼吸照護", "衛教需求"]
  },
  "pat-007": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "長期臥床，近期便祕與睡眠品質改善中。",
    precautions: "家屬下午較方便，必要時先電話提醒。",
    medication_summary: "軟便劑、營養補充品、睡前舒眠藥。",
    last_visit_summary: "上次訪後家屬回饋排便與睡眠皆有改善。",
    next_follow_up_focus: "排便頻率、睡眠品質與翻身疼痛。",
    reminder_tags: ["便祕追蹤", "先電話提醒"]
  },
  "pat-008": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "中風後肩頸僵硬，目前訪視暫停中。",
    precautions: "若恢復排程，需先重整家屬可配合時段。",
    medication_summary: "復健止痛藥、慢性病藥物持續中。",
    last_visit_summary: "病家要求改期，目前等待重新安排。",
    next_follow_up_focus: "肩頸僵硬程度與復訪意願。",
    reminder_tags: ["暫停服務", "待重新安排"]
  },
  "pat-009": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "慢性胃食道逆流，飲食與睡前習慣需追蹤。",
    precautions: "主要家屬白天可能不在，必要時聯絡配偶。",
    medication_summary: "制酸劑、腸胃蠕動藥、睡前避免刺激性食物。",
    last_visit_summary: "因個案外出取消，家屬同意改由行政另約。",
    next_follow_up_focus: "飲食內容、夜間胃悶與反酸頻率。",
    reminder_tags: ["飲食追蹤", "可能需晚間聯絡"]
  },
  "pat-010": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "癌後虛弱調理，上午精神與食慾相對較好。",
    precautions: "家屬希望固定上午，若醫師請假需優先改派。",
    medication_summary: "止痛藥、營養補充品、腸胃保護藥。",
    last_visit_summary: "固定上午追蹤，家屬願配合提早通知。",
    next_follow_up_focus: "食慾、精神體力與疼痛控制。",
    reminder_tags: ["上午固定", "請假需改派"]
  },
  "pat-011": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "失智症合併睡眠障礙，已改為月訪。",
    precautions: "月初需由行政先確認家屬可配合時段。",
    medication_summary: "失智症用藥、睡前輔助藥物、營養補充。",
    last_visit_summary: "家屬希望月訪時保留重點摘要，避免資訊過多。",
    next_follow_up_focus: "睡眠品質、照護負荷與安全感。",
    reminder_tags: ["月訪", "摘要需精簡"]
  },
  "pat-012": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "住院後恢復期，慢性腰背痛與虛弱待重新評估。",
    precautions: "目前先以電話追蹤，確認是否恢復居家訪視。",
    medication_summary: "止痛藥、營養補充、出院後新調整慢性病藥。",
    last_visit_summary: "家屬希望先電話關懷，再決定恢復訪視時間。",
    next_follow_up_focus: "恢復意願、體力與疼痛變化。",
    reminder_tags: ["出院後關懷", "先電話追蹤"]
  },
  "pat-013": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "慢性肩頸僵硬，近三個月痠痛反覆。",
    precautions: "上午施作前需先提醒家屬協助熱敷。",
    medication_summary: "止痛藥 PRN、維生素 B 群、睡前舒緩藥物。",
    last_visit_summary: "肩頸緊繃在天冷時特別明顯。",
    next_follow_up_focus: "追蹤肩頸痠痛、睡眠與頭暈狀況。",
    reminder_tags: ["肩頸追蹤", "上午安排"]
  },
  "pat-014": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "退化性膝痛與步態不穩，外出意願降低。",
    precautions: "移位時需家屬在旁扶持，避免久站。",
    medication_summary: "止痛藥、關節保健品、鈣片。",
    last_visit_summary: "家屬表示上下樓梯時膝痛明顯。",
    next_follow_up_focus: "疼痛程度、步態與居家活動量。",
    reminder_tags: ["步態觀察", "上午安排"]
  },
  "pat-015": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "睡眠障礙合併慢性疲倦，下午精神較穩。",
    precautions: "訪後需留一份簡短作息建議給家屬。",
    medication_summary: "安眠藥、營養補充品、慢性病固定藥物。",
    last_visit_summary: "近期白天嗜睡減少，但夜間仍易醒。",
    next_follow_up_focus: "睡眠品質、食慾與精神體力。",
    reminder_tags: ["睡眠追蹤", "下午安排"]
  },
  "pat-016": {
    preferred_doctor_id: "doc-001",
    important_medical_history: "慢性腰背痛與食慾下降，下午較容易配合訪視。",
    precautions: "施作前先確認當日進食情況與血壓。",
    medication_summary: "止痛藥、胃藥、營養補充飲。",
    last_visit_summary: "家屬反映最近晚餐食量偏少。",
    next_follow_up_focus: "疼痛、食慾與夜間睡眠狀況。",
    reminder_tags: ["腰背痛", "下午安排"]
  }
};

export const patientsSeed: Patient[] = patientRows.map(
  ([
    id,
    chart_number,
    name,
    gender,
    date_of_birth,
    phone,
    address,
    primary_diagnosis,
    notes,
    status
  ]) => {
    const extras = patientCareExtras[id];
    const coords = patientCoordinates[id];
    const numericId = Number(id.replace("pat-", ""));
    return {
      id,
      chart_number,
      name,
      service_needs:
        id === "pat-004" || id === "pat-005" || id === "pat-010"
          ? ["中藥", "針灸"]
          : id === "pat-003" || id === "pat-006"
            ? ["針灸"]
            : ["中藥"],
      preferred_service_slot: numericId <= 8 ? "星期三上午" : "星期四下午",
      gender,
      date_of_birth,
      phone,
      address,
      home_address: address,
      location_keyword: "同住址",
      home_latitude: coords.latitude,
      home_longitude: coords.longitude,
      geocoding_status: coords.geocoding_status,
      google_maps_link: mapsLink(address, "同住址"),
      patient_tag: `${status === "active" ? "常規" : "特殊"}照護`,
      primary_diagnosis,
      preferred_doctor_id: extras.preferred_doctor_id,
      important_medical_history: extras.important_medical_history,
      precautions: extras.precautions,
      medication_summary: extras.medication_summary,
      last_visit_summary: extras.last_visit_summary,
      next_follow_up_focus: extras.next_follow_up_focus,
      reminder_tags: extras.reminder_tags,
      status,
      notes,
      ...stamp(-6)
    };
  }
);
