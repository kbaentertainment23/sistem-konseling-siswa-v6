import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SibkProvider, useSibk } from './context/SibkContext';
import { LoginScreen } from './components/LoginScreen';
import { Layout } from './components/Layout';
import { StudentProfileModal } from './components/StudentProfileModal';
import { OfflineIndicator } from './components/PWAInstallButton';
import { RealtimeNotificationToast } from './components/RealtimeNotificationToast';
import { syncPWABrandingWithLogo } from './utils/pwaBranding';
import { subscribeSharedDriveSession } from './lib/googleDrive';
import { DashboardView } from './views/DashboardView';
import { StudentsView } from './views/StudentsView';
import { ClassesView } from './views/ClassesView';
import { AttendanceView } from './views/AttendanceView';
import { AttendanceRecapView } from './views/AttendanceRecapView';
import { CasesView } from './views/CasesView';
import { MonitoringView } from './views/MonitoringView';
import { ParentCallsView } from './views/ParentCallsView';
import { SchedulesView } from './views/SchedulesView';
import { ReportsView } from './views/ReportsView';
import { UsersView } from './views/UsersView';
import { SettingsView } from './views/SettingsView';
import type { NavSection, Student } from './types/sibk';

const SibkAppShell: React.FC = () => {
  const {
    authReady,
    currentUser,
    settings,
    isAdmin,
    isCounselor,
    realtimeNotifications,
    dismissRealtimeNotification,
  } = useSibk();
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);
  const [preselectedCaseStudent, setPreselectedCaseStudent] = useState<Student | null>(null);
  const [preselectedScheduleStudent, setPreselectedScheduleStudent] = useState<Student | null>(null);
  const [preselectedParentCallDraft, setPreselectedParentCallDraft] = useState<{
    student: Student;
    reason: string;
    relatedCaseId?: string;
  } | null>(null);

  useEffect(() => {
    setActiveSection('dashboard');
    setProfileStudent(null);
    setPreselectedCaseStudent(null);
    setPreselectedScheduleStudent(null);
    setPreselectedParentCallDraft(null);
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    void syncPWABrandingWithLogo(settings.schoolLogoUrl, settings.schoolName);
  }, [settings.schoolLogoUrl, settings.schoolName]);

  useEffect(() => {
    if (!currentUser) return;
    return subscribeSharedDriveSession();
  }, [currentUser]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Memuat Sistem Informasi Bimbingan dan Konseling (SIBK)...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginScreen />
        <OfflineIndicator />
      </>
    );
  }

  const handleAddCaseForStudent = (student: Student) => {
    setPreselectedCaseStudent(student);
    setActiveSection('cases');
  };

  const handleCreateParentCallForCase = (draft: {
    student: Student;
    reason: string;
    relatedCaseId?: string;
  }) => {
    if (!isCounselor) return;
    setPreselectedParentCallDraft(draft);
    setActiveSection('parent-calls');
  };

  const handleScheduleForStudent = (student: Student) => {
    setPreselectedScheduleStudent(student);
    setActiveSection('schedules');
  };

  const safeSection: NavSection =
    (activeSection === 'users' || activeSection === 'settings') && !isAdmin
      ? 'dashboard'
      : (activeSection === 'monitoring' || activeSection === 'parent-calls') && !isCounselor
        ? 'dashboard'
        : activeSection;

  return (
    <>
      <Layout
        activeSection={safeSection}
        onNavigate={setActiveSection}
        onSelectStudent={setProfileStudent}
      >
        {safeSection === 'dashboard' && (
          <DashboardView
            onNavigate={setActiveSection}
            onSelectStudent={setProfileStudent}
          />
        )}
        {safeSection === 'students' && (
          <StudentsView onSelectStudent={setProfileStudent} />
        )}
        {safeSection === 'classes' && (
          <ClassesView onSelectStudent={setProfileStudent} />
        )}
        {safeSection === 'attendance' && <AttendanceView />}
        {safeSection === 'attendance-recap' && <AttendanceRecapView />}
        {safeSection === 'cases' && (
          <CasesView
            preselectedStudent={preselectedCaseStudent}
            onClearPreselected={() => setPreselectedCaseStudent(null)}
            onSelectStudent={setProfileStudent}
            onCreateParentCallForCase={handleCreateParentCallForCase}
          />
        )}
        {safeSection === 'monitoring' && isCounselor && (
          <MonitoringView
            onSelectStudent={setProfileStudent}
            onAddCaseForStudent={handleAddCaseForStudent}
            onCreateParentCallForStudent={(student, reasons) =>
              handleCreateParentCallForCase({
                student,
                reason:
                  reasons.length > 0
                    ? `Tindak lanjut pemantauan siswa (${reasons.join(', ')})`
                    : `Tindak lanjut pemantauan perkembangan ${student.fullName}`,
              })
            }
            onScheduleForStudent={handleScheduleForStudent}
          />
        )}
        {safeSection === 'parent-calls' && isCounselor && (
          <ParentCallsView
            preselectedDraft={preselectedParentCallDraft}
            onClearPreselectedDraft={() => setPreselectedParentCallDraft(null)}
          />
        )}
        {safeSection === 'schedules' && (
          <SchedulesView
            preselectedStudent={preselectedScheduleStudent}
            onClearPreselected={() => setPreselectedScheduleStudent(null)}
            onSelectStudent={setProfileStudent}
            onNavigate={setActiveSection}
          />
        )}
        {safeSection === 'reports' && (
          <ReportsView onSelectStudent={setProfileStudent} />
        )}
        {safeSection === 'users' && isAdmin && <UsersView />}
        {safeSection === 'settings' && isAdmin && <SettingsView />}
      </Layout>

      <StudentProfileModal
        student={profileStudent}
        onClose={() => setProfileStudent(null)}
        onAddCaseForStudent={handleAddCaseForStudent}
      />

      <OfflineIndicator />

      <RealtimeNotificationToast
        notifications={realtimeNotifications}
        onDismiss={dismissRealtimeNotification}
        onNavigate={setActiveSection}
      />
    </>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <SibkProvider>
        <SibkAppShell />
      </SibkProvider>
    </ErrorBoundary>
  );
}
