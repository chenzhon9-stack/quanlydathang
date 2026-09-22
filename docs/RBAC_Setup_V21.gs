/**
 * ============================================================================
 * RBAC Setup + Seed + Migrate — V21.02 → WebOrder (Viết Hải)
 * ============================================================================
 * Sheets tạo mới:
 *   Roles | Permissions | RolePermissions | UserRoles (nếu chưa có)
 *
 * Nguyên tắc:
 * - UserRoles hiện trống / chưa dùng → được phép migrate từ User.Role
 * - Không tạo bảng ManagementGroups
 * - Quanly giữ nguyên trên User (tách `;` theo V21; chấp nhận `,`)
 * - Seed = Permission Matrix LOCK (STEP 6 / D85)
 * - Apply chỉ sau DryRun; có Lock + Audit log (Logger)
 *
 * Cách chạy (Apps Script bound spreadsheet V21):
 *   1) setupRBACSheets()
 *   2) seedAllRBAC()          // roles + permissions + rolePermissions
 *   3) rbacMigrationDryRun()  // xem kết quả Log
 *   4) rbacMigrationApply()   // ghi UserRoles
 *   5) rbacValidate()
 * ============================================================================
 */

var RBAC = {
  SHEETS: {
    ROLES: 'Roles',
    PERMISSIONS: 'Permissions',
    ROLE_PERMISSIONS: 'RolePermissions',
    USER_ROLES: 'UserRoles',
    USER: 'User',
    AUDIT: 'AuditLog'
  },
  HEADERS: {
    Roles: ['RoleCode', 'TenRole', 'HoatDong', 'GhiChu', 'UpdatedAt'],
    Permissions: ['PermCode', 'Nhom', 'MoTa', 'HoatDong', 'UpdatedAt'],
    RolePermissions: ['RoleCode', 'PermCode', 'HoatDong', 'UpdatedAt'],
    UserRoles: ['Email', 'RoleCode', 'HoatDong', 'Source', 'UpdatedAt', 'UpdatedBy']
  }
};

// ---------------------------------------------------------------------------
// Permission Baseline V21 (D85) — Role → Permission[]
// ---------------------------------------------------------------------------
function getRolePermissionMatrix_() {
  return {
    ADMIN: ['*'],
    MANAGER: [
      'DELIVERY_VIEW', 'DELIVERY_UPDATE',
      'DELIVERY_VIEW_ACTUAL_RECEIVE', 'DELIVERY_VIEW_ACTUAL_DELIVER',
      'PLAN_VIEW', 'REPORT_VIEW', 'PAYABLE_VIEW',
      'PURCHASE_PRICE_VIEW', 'KHSL_VIEW'
    ],
    PURCHASE: [
      'ORDER_VIEW', 'ORDER_CREATE', 'ORDER_RECEIVE', 'ORDER_SEND', 'ORDER_CANCEL',
      'DELIVERY_VIEW', 'DELIVERY_UPDATE',
      'DELIVERY_VIEW_ACTUAL_RECEIVE', 'DELIVERY_VIEW_ACTUAL_DELIVER',
      'REPORT_VIEW', 'PAYABLE_VIEW', 'PAYABLE_CREATE',
      'PURCHASE_PRICE_VIEW', 'PURCHASE_PRICE_UPDATE',
      'KHSL_VIEW', 'KHSL_UPDATE'
    ],
    DISPATCHER: [
      'ORDER_VIEW', 'ORDER_CREATE', 'ORDER_SEND',
      'DELIVERY_VIEW', 'DELIVERY_UPDATE',
      'DELIVERY_VIEW_ACTUAL_RECEIVE', 'DELIVERY_VIEW_ACTUAL_DELIVER',
      'REPORT_VIEW', 'KHSL_VIEW'
    ],
    SALES: [
      'DELIVERY_VIEW', 'DELIVERY_UPDATE', 'DELIVERY_VIEW_ACTUAL_DELIVER',
      'REPORT_VIEW'
    ],
    VIEWER: [
      'DELIVERY_VIEW', 'DELIVERY_VIEW_ACTUAL_DELIVER', 'REPORT_VIEW'
    ],
    ACCOUNTANT: [
      'DELIVERY_VIEW', 'DELIVERY_UPDATE',
      'DELIVERY_VIEW_ACTUAL_RECEIVE', 'DELIVERY_VIEW_ACTUAL_DELIVER',
      'REPORT_VIEW', 'PAYABLE_VIEW', 'PAYABLE_CREATE'
    ]
  };
}

function getAllPermissionDefs_() {
  return [
    ['ORDER_VIEW', 'ORDER', 'Xem đơn hàng'],
    ['ORDER_CREATE', 'ORDER', 'Tạo đơn hàng'],
    ['ORDER_RECEIVE', 'ORDER', 'Nhận hàng (chi tiết)'],
    ['ORDER_SEND', 'ORDER', 'Gửi đơn NCC'],
    ['ORDER_CANCEL', 'ORDER', 'Hủy đơn'],
    ['DELIVERY_VIEW', 'DELIVERY', 'Xem giao hàng'],
    ['DELIVERY_UPDATE', 'DELIVERY', 'Sửa giao hàng'],
    ['DELIVERY_VIEW_ACTUAL_RECEIVE', 'DELIVERY', 'Xem thực nhận'],
    ['DELIVERY_VIEW_ACTUAL_DELIVER', 'DELIVERY', 'Xem thực giao'],
    ['PLAN_VIEW', 'PLAN', 'Xem kế hoạch'],
    ['PLAN_UPDATE', 'PLAN', 'Sửa kế hoạch'],
    ['REPORT_VIEW', 'REPORT', 'Xem báo cáo'],
    ['PAYABLE_VIEW', 'FINANCE', 'Xem công nợ'],
    ['PAYABLE_CREATE', 'FINANCE', 'Tạo công nợ'],
    ['PAYABLE_CANCEL', 'FINANCE', 'Hủy công nợ'],
    ['PURCHASE_PRICE_VIEW', 'PRICE', 'Xem giá mua'],
    ['PURCHASE_PRICE_UPDATE', 'PRICE', 'Sửa giá mua'],
    ['KHSL_VIEW', 'KHSL', 'Xem KH sản lượng'],
    ['KHSL_UPDATE', 'KHSL', 'Sửa KH sản lượng'],
    ['MASTER_UPDATE', 'MASTER', 'Sửa danh mục'],
    ['USER_VIEW', 'USER', 'Xem tài khoản'],
    ['USER_MANAGE', 'USER', 'Quản trị tài khoản'],
    ['*', 'SYSTEM', 'Toàn quyền (ADMIN)']
  ];
}

function getRoleDefs_() {
  return [
    ['ADMIN', 'Quản trị viên', 'Toàn quyền + User/Master'],
    ['MANAGER', 'Quản lý', 'Báo cáo, giao, KH, công nợ xem'],
    ['PURCHASE', 'Mua hàng', 'Đơn + nhận + giá + KHSL + công nợ'],
    ['DISPATCHER', 'Điều phối', 'Đơn owner-scope + giao'],
    ['SALES', 'Bán hàng', 'Giao theo management scope'],
    ['VIEWER', 'Chỉ xem', 'Giao + báo cáo read-only'],
    ['ACCOUNTANT', 'Kế toán', 'Giao + công nợ']
  ];
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------
function getSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(name, headers) {
  var ss = getSs_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    Logger.log('Created sheet: ' + name);
  }
  if (headers && headers.length) {
    var lastCol = sh.getLastColumn();
    var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var needHeader = existing.length === 0 || String(existing[0] || '') === '';
    if (needHeader) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sh;
}

function readSheetObjects_(sheetName) {
  var sh = getSs_().getSheetByName(sheetName);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h || '').trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = values[i][c];
      obj[headers[c]] = v === null || v === undefined ? '' : v;
      if (String(obj[headers[c]]).trim() !== '') empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

function clearDataKeepHeader_(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, sh.getMaxColumns()).clearContent();
  }
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Email người chạy script — không bắt buộc scope userinfo.email.
 * getActiveUser() hay ném Exception thiếu permission → ưu tiên getEffectiveUser + fallback.
 */
function safeRunnerEmail_() {
  try {
    var eff = Session.getEffectiveUser();
    if (eff) {
      var e1 = eff.getEmail();
      if (e1) return e1;
    }
  } catch (err1) {
    /* ignore */
  }
  try {
    var act = Session.getActiveUser();
    if (act) {
      var e2 = act.getEmail();
      if (e2) return e2;
    }
  } catch (err2) {
    /* thiếu https://www.googleapis.com/auth/userinfo.email */
  }
  return 'system';
}

function normalizeRole_(raw) {
  var s = String(raw || '').trim().toUpperCase();
  s = s.replace(/\s+/g, '');
  var map = {
    'ADMIN': 'ADMIN',
    'QUANTRI': 'ADMIN',
    'QUẢNTRỊ': 'ADMIN',
    'MANAGER': 'MANAGER',
    'QUANLY': 'MANAGER',
    'QUẢNLÝ': 'MANAGER',
    'PURCHASE': 'PURCHASE',
    'MUAHANG': 'PURCHASE',
    'MUA HÀNG': 'PURCHASE',
    'DISPATCHER': 'DISPATCHER',
    'DIEUPHOI': 'DISPATCHER',
    'ĐIỀUPHỐI': 'DISPATCHER',
    'SALES': 'SALES',
    'BANHANG': 'SALES',
    'VIEWER': 'VIEWER',
    'XEM': 'VIEWER',
    'ACCOUNTANT': 'ACCOUNTANT',
    'KETOAN': 'ACCOUNTANT',
    'ACCOUNT': 'ACCOUNTANT'
  };
  if (map[s]) return map[s];
  // strip accents rough
  var fold = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  if (map[fold]) return map[fold];
  if (fold === 'QUANTRI') return 'ADMIN';
  if (fold === 'QUANLY') return 'MANAGER';
  if (fold === 'MUAHANG') return 'PURCHASE';
  if (fold === 'DIEUPHOI') return 'DISPATCHER';
  if (fold === 'BANHANG') return 'SALES';
  if (fold === 'KETOAN') return 'ACCOUNTANT';
  return s || '';
}

// ===============================
// RBAC SETUP
// ===============================

/**
 * Tạo 4 sheet control (nếu chưa có) + header chuẩn.
 * KHÔNG ghi đè dữ liệu User.
 */
function setupRBACSheets() {
  ensureSheet_(RBAC.SHEETS.ROLES, RBAC.HEADERS.Roles);
  ensureSheet_(RBAC.SHEETS.PERMISSIONS, RBAC.HEADERS.Permissions);
  ensureSheet_(RBAC.SHEETS.ROLE_PERMISSIONS, RBAC.HEADERS.RolePermissions);
  ensureSheet_(RBAC.SHEETS.USER_ROLES, RBAC.HEADERS.UserRoles);
  SpreadsheetApp.flush();
  Logger.log('setupRBACSheets: OK');
  return 'OK — Roles, Permissions, RolePermissions, UserRoles';
}

/**
 * Seed roles (idempotent: clear data rows rồi ghi lại baseline).
 */
function seedRBACRoles() {
  setupRBACSheets();
  var sh = getSs_().getSheetByName(RBAC.SHEETS.ROLES);
  clearDataKeepHeader_(sh);
  var now = nowIso_();
  var rows = getRoleDefs_().map(function (r) {
    return [r[0], r[1], true, r[2], now];
  });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 5).setValues(rows);
  }
  Logger.log('seedRBACRoles: ' + rows.length + ' roles');
  return rows.length;
}

/**
 * Seed permissions catalog.
 */
function seedRBACPermissions() {
  setupRBACSheets();
  var sh = getSs_().getSheetByName(RBAC.SHEETS.PERMISSIONS);
  clearDataKeepHeader_(sh);
  var now = nowIso_();
  var rows = getAllPermissionDefs_().map(function (p) {
    return [p[0], p[1], p[2], true, now];
  });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 5).setValues(rows);
  }
  Logger.log('seedRBACPermissions: ' + rows.length);
  return rows.length;
}

/**
 * Seed Role ↔ Permission theo matrix LOCK.
 */
function seedRBACRolePermissions() {
  setupRBACSheets();
  var sh = getSs_().getSheetByName(RBAC.SHEETS.ROLE_PERMISSIONS);
  clearDataKeepHeader_(sh);
  var now = nowIso_();
  var matrix = getRolePermissionMatrix_();
  var rows = [];
  Object.keys(matrix).forEach(function (role) {
    matrix[role].forEach(function (perm) {
      rows.push([role, perm, true, now]);
    });
  });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows);
  }
  Logger.log('seedRBACRolePermissions: ' + rows.length);
  return rows.length;
}

/** Chạy 3 seed cùng lúc */
function seedAllRBAC() {
  seedRBACRoles();
  seedRBACPermissions();
  seedRBACRolePermissions();
  return 'seedAllRBAC done';
}

// ===============================
// MIGRATION (User → UserRoles)
// ===============================

/**
 * Đọc User sheet → đề xuất mapping Role (không ghi).
 */
function buildUserRoleMigrationPlan_() {
  var users = readSheetObjects_(RBAC.SHEETS.USER);
  var existingUR = readSheetObjects_(RBAC.SHEETS.USER_ROLES);
  var existingKeys = {};
  existingUR.forEach(function (r) {
    var e = String(r.Email || '').trim().toLowerCase();
    var role = normalizeRole_(r.RoleCode || '');
    if (e && role) existingKeys[e + '|' + role] = true;
  });

  var plan = {
    usersTotal: users.length,
    mappings: [],
    invalidRoles: [],
    missingEmail: [],
    alreadyOnUserRoles: [],
    conflicts: [],
    userRolesExistingRows: existingUR.length
  };

  var matrix = getRolePermissionMatrix_();
  var validRoles = Object.keys(matrix);

  users.forEach(function (u) {
    var email = String(u.Email || u.email || '').trim().toLowerCase();
    if (!email) {
      plan.missingEmail.push(u);
      return;
    }

    var rawRole = u.Role || u.role || u.VaiTro || '';
    var role = normalizeRole_(rawRole);

    if (!role || validRoles.indexOf(role) < 0) {
      plan.invalidRoles.push({
        email: email,
        rawRole: rawRole,
        normalized: role
      });
      return;
    }

    var key = email + '|' + role;
    var skip = !!existingKeys[key];

    if (skip) {
      plan.alreadyOnUserRoles.push({
        email: email,
        roleCode: role
      });
    }

    plan.mappings.push({
      email: email,
      roleCode: role,
      hoTen: String(u.HoTen || u.hoTen || ''),
      quanly: String(u.Quanly || u.QuanLy || ''),
      skip: skip
    });
  });

  return plan;
}

/**
 * Dry-run: không ghi dữ liệu. Xem View → Logs.
 */
function rbacMigrationDryRun() {
  setupRBACSheets();
  var plan = buildUserRoleMigrationPlan_();
  Logger.log('=== RBAC MIGRATION DRY RUN ===');
  Logger.log('Users total: ' + plan.usersTotal);
  Logger.log('UserRoles existing rows: ' + plan.userRolesExistingRows);
  Logger.log('Will insert: ' + plan.mappings.filter(function (m) { return !m.skip; }).length);
  Logger.log('Already on UserRoles (skip): ' + plan.alreadyOnUserRoles.length);
  Logger.log('Invalid/unknown roles (normalized): ' + JSON.stringify(plan.invalidRoles));
  Logger.log('Missing email rows: ' + plan.missingEmail.length);
  Logger.log('Sample mappings: ' + JSON.stringify(plan.mappings.slice(0, 10)));
  return plan;
}

/**
 * Apply: ghi UserRoles từ User.Role (chỉ dòng chưa có Email).
 * Có Lock document; ghi AuditLog nếu sheet tồn tại.
 */
function rbacMigrationApply() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Lock timeout — thử lại sau');
  }
  try {
    setupRBACSheets();
    var plan = buildUserRoleMigrationPlan_();
    var toWrite = plan.mappings.filter(function (m) { return !m.skip; });
    if (!toWrite.length) {
      Logger.log('rbacMigrationApply: nothing to write');
      return { written: 0, skipped: plan.alreadyOnUserRoles.length };
    }

    var sh = getSs_().getSheetByName(RBAC.SHEETS.USER_ROLES);
    var now = nowIso_();
    var actor = safeRunnerEmail_();
    var rows = toWrite.map(function (m) {
      return [m.email, m.roleCode, true, 'MIGRATE_FROM_USER', now, actor];
    });
    var startRow = Math.max(2, sh.getLastRow() + 1);
    sh.getRange(startRow, 1, rows.length, 6).setValues(rows);

    appendAudit_({
      Action: 'RBAC_USERROLES_MIGRATE',
      Source: 'rbacMigrationApply',
      NewValue: 'written=' + rows.length,
      LyDo: 'Migrate User.Role → UserRoles (empty sheet bootstrap)'
    });

    Logger.log('rbacMigrationApply: written=' + rows.length);
    return { written: rows.length, skipped: plan.alreadyOnUserRoles.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Alias tên trong sơ đồ user: migrateUsersToUserRoles = apply
 * (chỉ chạy khi đã dry-run và xác nhận)
 */
function migrateUsersToUserRoles() {
  return rbacMigrationApply();
}

// ===============================
// VALIDATE / PREVIEW
// ===============================

function rbacValidate() {
  setupRBACSheets();

  var roles = readSheetObjects_(RBAC.SHEETS.ROLES);
  var perms = readSheetObjects_(RBAC.SHEETS.PERMISSIONS);
  var rp = readSheetObjects_(RBAC.SHEETS.ROLE_PERMISSIONS);
  var ur = readSheetObjects_(RBAC.SHEETS.USER_ROLES);
  var users = readSheetObjects_(RBAC.SHEETS.USER);

  var roleSet = {};
  roles.forEach(function (r) {
    var rc = String(r.RoleCode || '').trim().toUpperCase();
    if (rc) roleSet[rc] = true;
  });

  var permSet = {};
  perms.forEach(function (p) {
    var pc = String(p.PermCode || '').trim().toUpperCase();
    if (pc) permSet[pc] = true;
  });

  var report = {
    ok: true,
    rolesCount: roles.length,
    permissionsCount: perms.length,
    rolePermissionsCount: rp.length,
    userRolesCount: ur.length,
    usersCount: users.length,
    orphanRolePermissions: [],
    invalidUserRoles: [],
    duplicateUserRoles: [],
    usersWithoutUserRoles: [],
    roleMismatchWithLegacyUser: [],
    invalidManagementGroups: []
  };

  rp.forEach(function (row) {
    var rc = String(row.RoleCode || '').trim().toUpperCase();
    var pc = String(row.PermCode || '').trim().toUpperCase();

    if (!roleSet[rc] || (!permSet[pc] && pc !== '*')) {
      report.orphanRolePermissions.push({
        RoleCode: rc,
        PermCode: pc
      });
    }
  });

  var seen = {};
  ur.forEach(function (row) {
    var e = String(row.Email || '').trim().toLowerCase();
    var rc = normalizeRole_(row.RoleCode || '');
    var key = e + '|' + rc;

    if (!e) {
      report.invalidUserRoles.push({
        email: e,
        RoleCode: rc,
        reason: 'MISSING_EMAIL'
      });
    }

    if (!roleSet[rc]) {
      report.invalidUserRoles.push({
        email: e,
        RoleCode: rc,
        reason: 'INVALID_ROLE'
      });
    }

    if (seen[key]) {
      report.duplicateUserRoles.push({
        email: e,
        RoleCode: rc
      });
    }
    seen[key] = true;
  });

  users.forEach(function (u) {
    var e = String(u.Email || '').trim().toLowerCase();
    if (!e) return;

    var legacyRole = normalizeRole_(u.Role || '');
    var key = e + '|' + legacyRole;

    if (!seen[key]) {
      report.usersWithoutUserRoles.push({
        email: e,
        legacyRole: legacyRole
      });
    }
  });

  report.ok =
    report.orphanRolePermissions.length === 0 &&
    report.invalidUserRoles.length === 0 &&
    report.duplicateUserRoles.length === 0 &&
    report.usersWithoutUserRoles.length === 0;

  Logger.log('=== RBAC VALIDATE ===');
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function rbacPreviewUsers() {
  var plan = buildUserRoleMigrationPlan_();
  var matrix = getRolePermissionMatrix_();

  var preview = plan.mappings.map(function (m) {
    var permissions = matrix[m.roleCode] || [];

    return {
      email: m.email,
      legacyRole: m.roleCode,
      managementGroups: parseManagementGroups_(m.quanly).groups,
      permissions: permissions,
      onUserRoles: m.skip,
      action: m.skip ? 'SKIP_EXISTING' : 'INSERT'
    };
  });

  Logger.log(JSON.stringify(preview, null, 2));
  return preview;
}

function rbacCheckUser(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) throw new Error('email required');

  var users = readSheetObjects_(RBAC.SHEETS.USER);
  var user = null;

  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Email || '').trim().toLowerCase() === email) {
      user = users[i];
      break;
    }
  }

  var ur = readSheetObjects_(RBAC.SHEETS.USER_ROLES).filter(function (r) {
    return String(r.Email || '').trim().toLowerCase() === email &&
      String(r.HoatDong).toLowerCase() !== 'false';
  });

  var roleFromUser = user ? normalizeRole_(user.Role || '') : '';
  var rolesFromUR = ur.map(function (r) {
    return normalizeRole_(r.RoleCode || '');
  }).filter(Boolean);

  // Compatibility fallback: nếu UserRoles chưa có assignment,
  // vẫn nhìn thấy Role cũ để kiểm tra migration.
  var effectiveRoles = rolesFromUR.length
    ? rolesFromUR
    : (roleFromUser ? [roleFromUser] : []);

  var matrix = getRolePermissionMatrix_();
  var permissions = {};

  effectiveRoles.forEach(function (role) {
    (matrix[role] || []).forEach(function (perm) {
      permissions[perm] = true;
    });
  });

  var permsFromSheet = [];
  readSheetObjects_(RBAC.SHEETS.ROLE_PERMISSIONS).forEach(function (row) {
    var rowRole = normalizeRole_(row.RoleCode || '');
    var active = String(row.HoatDong).toLowerCase() !== 'false';

    if (active && effectiveRoles.indexOf(rowRole) !== -1) {
      var perm = String(row.PermCode || '').trim();
      if (perm) {
        permsFromSheet.push(perm);
        permissions[perm] = true;
      }
    }
  });

  return {
    email: email,
    foundUser: !!user,
    roleFromUser: roleFromUser,
    rolesFromUserRoles: rolesFromUR,
    effectiveRoles: effectiveRoles,
    managementGroups: parseManagementGroups_(user ? (user.Quanly || user.QuanLy || '') : '').groups,
    permissionsMatrixUnion: Object.keys(permissions).sort(),
    permissionsFromSheet: permsFromSheet,
    userRolesRows: ur,
    note: 'Quanly = Data Scope; UserRoles = Role assignment.'
  };
}

/** V21 FACT: Quanly tách bằng `;` (chấp nhận thêm `,`). "tất cả"/"all" = isAll */
function parseManagementGroups_(value) {
  var raw = String(value || '').trim();
  if (!raw) return { isAll: false, groups: [] };
  var fold = raw.toLowerCase().normalize
    ? raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : raw.toLowerCase();
  if (fold === 'tat ca' || fold === 'all') return { isAll: true, groups: [] };
  var groups = raw.split(/[;,]/).map(function (x) {
    return String(x).trim();
  }).filter(Boolean);
  return { isAll: false, groups: groups };
}

/**
 * Kiểm tra nhanh trước APPLY.
 * APPLY chỉ nên thực hiện khi:
 * - UserRoles đang trống hoặc đã được kiểm tra
 * - DryRun không có invalid role/missing email
 * - không có duplicate Email + Role
 */
function rbacPreApplyCheck() {
  var dry = rbacMigrationDryRun();

  return {
    ok: dry.invalidRoles.length === 0 &&
        dry.missingEmail.length === 0,
    usersTotal: dry.usersTotal,
    insertCount: dry.mappings.filter(function (m) {
      return !m.skip;
    }).length,
    existingAssignments: dry.alreadyOnUserRoles.length,
    invalidRoles: dry.invalidRoles,
    missingEmail: dry.missingEmail.length,
    recommendation:
      'Nếu ok=true mới chạy rbacMigrationApply().'
  };
}

function appendAudit_(fields) {
  var sh = getSs_().getSheetByName(RBAC.SHEETS.AUDIT);
  if (!sh) return;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (!headers || !headers.length) return;
  var row = headers.map(function (h) {
    h = String(h || '').trim();
    if (h === 'Timestamp') return nowIso_();
    if (h === 'Email') return safeRunnerEmail_();
    if (h === 'Role') return 'ADMIN';
    if (fields[h] !== undefined) return fields[h];
    return '';
  });
  sh.appendRow(row);
}

/**
 * Menu tiện chạy tay
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('RBAC V21')
      .addItem('1. Setup sheets', 'setupRBACSheets')
      .addItem('2. Seed all (Roles/Perms/Map)', 'seedAllRBAC')
      .addItem('3. Dry-run migrate User→UserRoles', 'rbacMigrationDryRun')
      .addItem('4. APPLY migrate User→UserRoles', 'rbacMigrationApply')
      .addItem('5. Validate', 'rbacValidate')
      .addItem('Preview users', 'rbacPreviewUsers')
      .addToUi();
  } catch (e) {
    // bound script without UI
  }
}
