import {requireStaff} from '@/lib/auth';
import {TasksClient} from '@/components/control/TasksClient';
export const dynamic='force-dynamic';
export const metadata={title:'All Tasks'};
export default async function Page(){await requireStaff();return <TasksClient/>;}
